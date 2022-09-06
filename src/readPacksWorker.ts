import {
  SCHEMA_FIELD_TYPE,
  Field,
  DBVersion,
  PackTableCollision,
  PackFileCollision,
  Pack,
  PackedFile,
  SchemaField,
} from "./packFileTypes";

const { workerData, parentPort } = require("worker_threads");
const BinaryFile = require("binary-file");

function parseTypeBuffer(
  buffer: Buffer,
  pos: number,
  type: SCHEMA_FIELD_TYPE,
  existingFields?: Field[]
): [Field[], number] {
  const fields: Field[] = existingFields || [];
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const val = buffer.readUInt8(pos); //await file.readUInt8();
        pos += 1;
        fields.push({ type: "UInt8", val });
        return [fields, pos];
        // await outFile.writeInt8(newVal !== undefined ? newVal : val);
      }
      break;
    case "ColourRGB":
      {
        const val = buffer.readInt32LE(pos); // await file.readInt32();
        pos += 4;
        fields.push({ type: "I32", val });
        return [fields, pos];
      }
      break;
    case "StringU16":
      {
        try {
          const length = buffer.readInt16LE(pos); //await file.readInt16();
          pos += 2;
          const val = buffer.subarray(pos, pos + length * 2).toString("utf8"); //(await file.read(length * 2)).toString("utf8");
          pos += length * 2;
          fields.push({ type: "String", val });
          return [fields, pos];
        } catch (e) {
          console.log(e);
        }
      }
      break;
    case "StringU8":
      {
        const length = buffer.readUint16LE(pos); //await file.readUInt16();
        pos += 2;
        const val = buffer.subarray(pos, pos + length).toString("ascii"); //await file.readString(length);
        pos += length;

        // console.log('string');
        // console.log('position is ' + file.tell());
        // const val = await read_string(file);

        // console.log(length);
        // console.log(val);
        fields.push({ type: "Int16", val: length });
        fields.push({ type: "String", val });
        return [fields, pos];
        // await outFile.writeString(val + '\0');
        // await outFile.writeInt16(length);
        // await outFile.writeString(val);
      }
      break;
    case "OptionalStringU8":
      {
        const doesExist = buffer.readUint8(pos); // await file.readUInt8();
        pos += 1;
        fields.push({ type: "Int8", val: doesExist });
        if (doesExist === 1) {
          return parseTypeBuffer(buffer, pos, "StringU8", fields);
        }

        return [fields, pos];
      }
      break;
    case "F32":
      {
        const doesExist = buffer.readFloatLE(pos); //await file.readFloat();
        pos += 4;
        fields.push({ type: "F32", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I32":
      {
        const doesExist = buffer.readInt32LE(pos); //await file.readInt32();
        pos += 4;
        fields.push({ type: "I32", val: doesExist });
        return [fields, pos];
      }
      break;
    case "F64":
      {
        const doesExist = buffer.readDoubleLE(pos); //await file.readDouble();
        pos += 8;
        fields.push({ type: "F64", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I64":
      {
        const doesExist = Number(buffer.readBigInt64LE(pos)); //await file.readInt64();
        pos += 8;
        fields.push({ type: "I64", val: doesExist });
        return [fields, pos];
      }
      break;
    default:
      console.log("NO WAY TO RESOLVE " + type);
      break;
  }
}

const readUTFStringFromBuffer = (buffer: Buffer, pos: number): [string, number] => {
  const length = buffer.readInt16LE(pos);
  pos += 2;
  // console.log('length is ' + length);
  // since utf8 is 2 bytes per char
  return [buffer.subarray(pos, pos + length * 2).toString("utf8"), pos + length * 2];
};

const DBNameToDBVersions: Record<string, DBVersion[]> = {};

// console.log("FFFFFFFFFFFFFF");
const vf = (workerData.schema as { versioned_files: any[] }).versioned_files as any[];
for (const versioned_file of vf) {
  if ("DB" in versioned_file) {
    // console.log(versioned_file.DB[0]);
    DBNameToDBVersions[versioned_file.DB[0]] = versioned_file.DB[1];
    // name: versioned_file.DB[0],
    // versions: versioned_file.DB[1],
    // });
  }
}

// const packsData: dataManager.Pack[] = [];

const readPack = async (modName: string, modPath: string): Promise<Pack> => {
  const pack_files: PackedFile[] = [];

  let file: typeof BinaryFile;
  try {
    file = new BinaryFile(modPath, "r", true);
    await file.open();

    // console.log(`${modPath} file opened`);

    const header = await file.read(4);
    if (header === null) throw new Error("header missing");

    const byteMask = await file.readInt32();
    const refFileCount = await file.readInt32();
    const pack_file_index_size = await file.readInt32();
    const pack_file_count = await file.readInt32();
    const packed_file_index_size = await file.readInt32();

    // console.log(`header is ${header}`);
    // console.log(`byteMask is ${byteMask}`);
    // console.log(`refFileCount is ${refFileCount}`);
    // console.log(`pack_file_index_size is ${pack_file_index_size}`);
    // console.log(`pack_file_count is ${pack_file_count}`);
    // console.log(`packed_file_index_size is ${packed_file_index_size}`);

    const header_buffer_len = 4;
    await file.readInt32(); // header_buffer

    const dataStart = 24 + header_buffer_len + pack_file_index_size + packed_file_index_size;
    // console.log("data starts at " + dataStart);

    let chunk;
    let file_pos = dataStart;

    // let terminatorIndex = -1;

    const headerSize = dataStart - file.tell();
    const headerBuffer = await file.read(headerSize);

    // console.log("header size is: " + headerSize);

    // console.time("1000files");
    let bufPos = 0;
    // console.log("pack_file_count is " + pack_file_count);
    for (let i = 0; i < pack_file_count; i++) {
      let name = "";

      const file_size = headerBuffer.readInt32LE(bufPos);
      bufPos += 4;
      const is_compressed = headerBuffer.readInt8(bufPos);
      bufPos += 1;
      // const file_size = (stream.read(4) as Buffer).readInt32LE();
      // const is_compressed = (stream.read(1) as Buffer).readInt8();

      const nameStartPos = bufPos;
      while (null !== (chunk = headerBuffer.readInt8(bufPos))) {
        bufPos += 1;
        // terminatorIndex = chunk.indexOf(stringTerminator);
        if (chunk == 0) {
          // chunks.push(chunk.subarray(0, terminatorIndex + 1));
          // name = Buffer.concat(chunks).toString("ascii");

          // chunks = [];
          // file.seek(file.tell() - (chunk.length - terminatorIndex));
          // chunks.push(chunk.subarray(terminatorIndex, chunk.length + 1));

          // console.log(String.fromCharCode(headerBuffer.readInt16BE(bufPos)));
          // console.log(String.fromCharCode(headerBuffer.readInt16LE(bufPos)));

          // console.log(Buffer.from([0xe9, 0x9c, 0x87]).toString("utf8"));
          // console.log(Buffer.from([0x87, 0x9c, 0xe9]).toString("utf8"));
          // console.log(headerBuffer.toString("utf8", nameStartPos, bufPos - 1));
          // console.log(headerBuffer.subarray(nameStartPos, bufPos-1).length);

          name = headerBuffer.toString("utf8", nameStartPos, bufPos - 1);
          break;
        }
        // chunks.push(chunk);
        // name += chunk;
        // console.log(`Read ${chunk.length} bytes of data...`);
      }

      // if (name.startsWith("db")) {
      //   console.log(name);
      // }

      // if (i === 1000) {
      // console.log(console.timeEnd("1000files"));
      // }
      // console.log("name is " + name);
      //   console.log("file_size is " + file_size);

      pack_files.push({
        name,
        file_size,
        start_pos: file_pos,
        // is_compressed,
        schemaFields: [],
        version: undefined,
        guid: undefined,
      });
      file_pos += file_size;
    }

    // console.log("num pack files: " + pack_files.length);

    // console.log("DONE READING FILE");

    // pack_files.forEach((pack_file) => {
    //   const db_name = pack_file.name.match(/db\\(.*?)\\/);
    //   if (db_name != null) {
    //     console.log(db_name);
    //     // console.log(pack_file.name);
    //   }
    // });

    // const battle_permissions = pack_files.filter((pack) =>
    //   pack.name.startsWith("db\\units_custom_battle_permissions_tables")
    // );

    const dbPackFiles = pack_files.filter((packFile) => {
      const dbNameMatch = packFile.name.match(/db\\(.*?)\\/);
      return dbNameMatch != null && dbNameMatch[1];
    });

    if (dbPackFiles.length < 1) return;

    const startPos = dbPackFiles.reduce(
      (previous, current) => (previous < current.start_pos ? previous : current.start_pos),
      Number.MAX_SAFE_INTEGER
    );

    const startOfLastPack = dbPackFiles.reduce(
      (previous, current) => (previous > current.start_pos ? previous : current.start_pos),
      -1
    );
    const endPos =
      dbPackFiles.find((packFile) => packFile.start_pos === startOfLastPack).file_size + startOfLastPack;
    // console.log("endPos is ", endPos);

    const buffer = await file.read(endPos - startPos, startPos);

    let currentPos = 0;
    for (const pack_file of pack_files) {
      if (!dbPackFiles.find((iterPackFile) => iterPackFile === pack_file)) continue;
      currentPos = pack_file.start_pos - startPos;
      // console.log(currentPos);

      const dbNameMatch = pack_file.name.match(/db\\(.*?)\\/);
      if (dbNameMatch == null) continue;
      const dbName = dbNameMatch[1];
      if (dbName == null) continue;

      const dbversions = DBNameToDBVersions[dbName];
      if (!dbversions) continue;

      // console.log(pack_file);

      let version: number = null;
      for (;;) {
        const marker = await buffer.subarray(currentPos, currentPos + 4);
        currentPos += 4;

        if (marker.toString("hex") === "fdfefcff") {
          const readUTF = readUTFStringFromBuffer(buffer, currentPos);
          // console.log("guid is " + readUTF[0]);
          pack_file.guid = readUTF[0];
          currentPos = readUTF[1];
        } else if (marker.toString("hex") === "fcfdfeff") {
          // console.log("found version marker");
          version = buffer.readInt32LE(currentPos); // await file.readInt32();
          currentPos += 4;

          pack_file.version = version;
          // await file.read(1);
          currentPos += 1;
        } else {
          // console.log(marker.toString("hex"));
          currentPos -= 4;
          // file.seek(file.tell() - 4);
          break;
        }
        // if (pack_file.name === "db\\character_skill_nodes_tables\\mixu_ll_empire") {
        // console.log(pack_file.name);
        // console.log(dbName);
        // console.log(file.tell());
        // console.log(dbName);
        // console.log(marker);
        // console.log("-------------------");
        // }
      }

      // if (version == null) {
      //   console.log("version is", version);
      //   console.log(pack_file.guid);
      //   console.log(pack_file.name);
      //   console.log(pack_file.start_pos);
      // }

      if (version == null) continue;
      const dbversion = dbversions.find((dbversion) => dbversion.version == version) || dbversions[0];
      if (!dbversion) continue;
      if (dbversion.version < version) continue;

      const entryCount = buffer.readInt32LE(currentPos); //await file.readInt32();
      currentPos += 4;
      // console.log("entry count is " + entryCount);
      // console.log("pos is " + file.tell());

      // console.log(dbName);
      // outFile.seek(file.tell());
      for (let i = 0; i < entryCount; i++) {
        for (const field of dbversion.fields) {
          const { name, field_type, is_key } = field;
          // console.log(name);
          // console.log(field_type);

          // if (name === 'general_unit') console.log("it's a general");
          // console.log("pos is " + outFile.tell());
          // console.log('i is ' + i);
          // const fields = await parseType(file, field_type);
          const fieldsRet = await parseTypeBuffer(buffer, currentPos, field_type);
          const fields = fieldsRet[0];
          currentPos = fieldsRet[1];

          if (!fields[1] && !fields[0]) {
            // console.log(name);
            // console.log(field_type);
          }
          const schemaField: SchemaField = {
            // name,
            type: field_type,
            fields,
            // isKey: is_key,
            // resolvedKeyValue: (is_key && fields[1] && fields[1].val.toString()) || fields[0].val.toString(),
          };
          if (is_key) schemaField.isKey = true;
          pack_file.schemaFields.push(schemaField);
        }
      }
    }
  } catch (e) {
    console.log(e);
  } finally {
    await file.close();
  }

  // console.log("read " + modName);
  // const mod = toRead.find((iterMod) => modName === iterMod.name);
  // if (mod) {
  //   toRead.splice(toRead.indexOf(mod), 1);
  // }
  // console.log(toRead.map((mod) => mod.name));

  return { name: modName, path: modPath, packedFiles: pack_files } as Pack;
};

if (workerData.checkCompat) {
  {
    const packFileCollisions = findPackFileCollisions(workerData.packsData);
    const packTableCollisions = findPackTableCollisions(workerData.packsData);
    parentPort.postMessage({ packFileCollisions, packTableCollisions });
  }
} else {
  try {
    const mods: any[] = workerData.mods;
    const packFieldsPromises = mods.map((mod) => {
      return readPack(mod.name, mod.path);
    });

    console.time("readPacks");
    Promise.allSettled(packFieldsPromises)
      .then((packFieldsSettled) => {
        const newPacksData = (
          packFieldsSettled.filter((pfs) => pfs.status === "fulfilled") as PromiseFulfilledResult<Pack>[]
        )
          .map((r) => r.value)
          .filter((packData) => packData);
        //   packsData.splice(0, packsData.length, ...newPacksData);
        console.timeEnd("readPacks"); //26.580s

        console.log(newPacksData[0]);
        console.log("READ PACKS DONE");
        parentPort.postMessage({ newPacksData });
      })
      .catch((e) => {
        console.log(e);
      });
  } catch (e) {
    console.log(e);
  }
}

function getDBName(packFile: PackedFile) {
  const dbNameMatch = packFile.name.match(/db\\(.*?)\\/);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
}

function getDBVersion(packFile: PackedFile) {
  const dbName = getDBName(packFile);
  const dbversions = DBNameToDBVersions[dbName];
  if (!dbversions) return;

  const dbversion = dbversions.find((dbversion) => dbversion.version == packFile.version) || dbversions[0];
  if (!dbversion) return;
  if (dbversion.version < packFile.version) return;
  return dbversion;
}

function findPackTableCollisions(packsData: Pack[]) {
  const packTableCollisions: PackTableCollision[] = [];
  console.time("compareKeys");
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      // for (const pack of packsData) {
      // for (const packTwo of packsData) {
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (pack.name === "data.pack" || packTwo.name === "data.pack") continue;

      for (const packFile of pack.packedFiles) {
        if (packFile.name === "settings.rpfm_reserved") continue;
        for (const packTwoFile of packTwo.packedFiles) {
          if (packTwoFile.name === "settings.rpfm_reserved") continue;

          const dbNameMatch1 = packFile.name.match(/db\\(.*?)\\/);
          if (dbNameMatch1 == null) continue;
          const dbName1 = dbNameMatch1[1];
          if (dbName1 == null) continue;

          const dbNameMatch2 = packTwoFile.name.match(/db\\(.*?)\\/);
          if (dbNameMatch2 == null) continue;
          const dbName2 = dbNameMatch2[1];
          if (dbName2 == null) continue;

          try {
            if (dbName1 === dbName2) {
              const firstVer = getDBVersion(packFile);
              const secondVer = getDBVersion(packTwoFile);
              if (firstVer == null || secondVer == null) continue;

              if (firstVer.fields.filter((field) => field.is_key).length > 1) continue;
              if (secondVer.fields.filter((field) => field.is_key).length > 1) continue;
              const firstVerKeyField = firstVer.fields.filter((field) => field.is_key)[0];

              const v1Keys = packFile.schemaFields.filter((field) => field.isKey);
              if (v1Keys.length < 1) continue;
              const v2Keys = packTwoFile.schemaFields.filter((field) => field.isKey);
              if (v2Keys.length < 1) continue;

              for (let ii = 0; ii < v1Keys.length; ii++) {
                const v1Fields = v1Keys[ii].fields;
                const v1 =
                  (v1Fields[1] && v1Fields[1].val != null && v1Fields[1].val.toString()) ||
                  v1Fields[0].val.toString();
                for (let jj = 0; jj < v2Keys.length; jj++) {
                  const v2Fields = v2Keys[jj].fields;
                  const v2 =
                    (v2Fields[1] && v2Fields[1].val != null && v2Fields[1].val.toString()) ||
                    v2Fields[0].val.toString();

                  if (v1 === v2) {
                    packTableCollisions.push({
                      firstPackName: pack.name,
                      secondPackName: packTwo.name,
                      fileName: packFile.name,
                      secondFileName: packTwoFile.name,
                      // key: packFile.schemaFields.find((field) => field.isKey).name,
                      key: firstVerKeyField.name,
                      value: v1,
                    });

                    packTableCollisions.push({
                      secondPackName: pack.name,
                      firstPackName: packTwo.name,
                      secondFileName: packFile.name,
                      fileName: packTwoFile.name,
                      // key: packFile.schemaFields.find((field) => field.isKey).name,
                      key: firstVerKeyField.name,
                      value: v1,
                    });
                    // console.log("FOUND CONFLICT");
                    // console.log(
                    //   pack.name,
                    //   packTwo.name,
                    //   packFile.name,
                    //   packTwoFile.name,
                    //   packFile.schemaFields.find((field) => field.isKey).name,
                    //   v1
                    // );
                  }
                }
              }
            }
          } catch (e) {
            console.log(e);
          }
        }
      }
    }
  }

  console.timeEnd("compareKeys");

  return packTableCollisions;
}

function findPackFileCollisions(packsData: Pack[]) {
  console.time("findPackFileCollisions");
  const conflicts: PackFileCollision[] = [];
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      // for (let j = 0; j < packsData.length; j++) {
      const packTwo = packsData[j];
      // for (const pack of packsData) {
      // for (const packTwo of packsData) {
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (pack.name === "data.pack" || packTwo.name === "data.pack") continue;

      for (const packFile of pack.packedFiles) {
        if (packFile.name === "settings.rpfm_reserved") continue;
        for (const packTwoFile of packTwo.packedFiles) {
          if (packTwoFile.name === "settings.rpfm_reserved") continue;
          if (packFile.name === packTwoFile.name) {
            conflicts.push({
              firstPackName: pack.name,
              secondPackName: packTwo.name,
              fileName: packFile.name,
            });

            conflicts.push({
              secondPackName: pack.name,
              firstPackName: packTwo.name,
              fileName: packFile.name,
            });
            // console.log("FOUND CONFLICT");
            // console.log(pack.name, packTwo.name, packFile.name);
          }
        }
      }
    }
  }
  console.timeEnd("findPackFileCollisions");
  return conflicts;
}
