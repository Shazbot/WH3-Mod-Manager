import BinaryFile from "binary-file";
import { Field, Pack, PackedFile, packsData, SchemaField, SCHEMA_FIELD_TYPE } from "./packFileDataManager";
import clone from "just-clone";

const string_schema = `{
    "units_custom_battle_permissions_tables": {
      "10": [
        ["faction", "StringU8", "1"],
        ["general_unit", "Boolean", "2"],
        ["unit", "StringU8", "0"],
        ["siege_unit_attacker", "Boolean", "3"],
        ["siege_unit_defender", "Boolean", "4"],
        ["general_portrait", "OptionalStringU8", "5"],
        ["general_uniform", "OptionalStringU8", "6"],
        ["set_piece_character", "OptionalStringU8", "7"],
        ["campaign_exclusive", "Boolean", "8"],
        ["armory_item_set", "OptionalStringU8", "9"]
      ]
    }}`;

const schema = JSON.parse(string_schema);
const latest_version = Object.keys(schema.units_custom_battle_permissions_tables).sort()[0];
const ver_schema = schema.units_custom_battle_permissions_tables[latest_version];

function getTypeSize(type: string, val: string | number | undefined = null) {
  switch (type) {
    case "Int8":
    case "UInt8":
      {
        return 1;
      }
      break;
    case "Int16":
      {
        return 2;
      }
      break;
    case "String":
      {
        return (val as string).length;
      }
      break;
  }
}

function getDataSize(data: SchemaField[]): number {
  let size = 0;
  for (const field of data) {
    for (const value of field.fields) {
      size += getTypeSize(value.type, value.val);
    }
  }
  return size;
}

async function parseType(
  file: BinaryFile,
  type: SCHEMA_FIELD_TYPE,
  existingFields?: Field[]
): Promise<Field[]> {
  const fields: Field[] = existingFields || [];
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const val = await file.readUInt8();
        fields.push({ type: "UInt8", val });
        return fields;
        // await outFile.writeInt8(newVal !== undefined ? newVal : val);
      }
      break;
    case "StringU8":
      {
        const length = await file.readInt16();
        const val = await file.readString(length);

        // console.log('string');
        // console.log('position is ' + file.tell());
        // const val = await read_string(file);

        // console.log(length);
        // console.log(val);
        fields.push({ type: "Int16", val: length });
        fields.push({ type: "String", val });
        return fields;
        // await outFile.writeString(val + '\0');
        // await outFile.writeInt16(length);
        // await outFile.writeString(val);
      }
      break;
    case "OptionalStringU8":
      {
        const doesExist = await file.readUInt8();
        fields.push({ type: "Int8", val: doesExist });
        if (doesExist === 1) return await parseType(file, "StringU8", fields);

        return fields;
      }
      break;
  }
}

export const writePack = async (path: string, enabledMods: Mod[]) => {
  let outFile: BinaryFile;
  try {
    const header = "PFH5";
    const byteMask = 3;
    const refFileCount = 0;
    const pack_file_index_size = 0;

    const battlePermissions = packsData
      .filter((packData) => enabledMods.find((enabledMod) => enabledMod.path === packData.path))
      .map((packData) => packData.packedFiles)
      .filter((packedFiles) =>
        packedFiles.filter((packedFile) =>
          packedFile.name.startsWith("db\\units_custom_battle_permissions_tables\\")
        )
      )
      .reduce((previous, packedFile) => previous.concat(packedFile), []);

    const battlePermissionsSchemaFields = battlePermissions.reduce(
      (previous, packedFile) => previous.concat(packedFile.schemaFields),
      []
    );
    const pack_files: PackedFile[] = [
      {
        name: `db\\units_custom_battle_permissions_tables\\pj_fimir_test`,
        file_size: getDataSize(battlePermissionsSchemaFields) + 91,
        start_pos: 0,
        is_compressed: 0,
        schemaFields: battlePermissionsSchemaFields,
        version: undefined,
        guid: undefined,
      },
    ];

    outFile = new BinaryFile(path, "w", true);
    await outFile.open();
    await outFile.writeString(header);
    await outFile.writeInt32(byteMask);
    await outFile.writeInt32(refFileCount);
    await outFile.writeInt32(pack_file_index_size);

    //   await outFile.writeInt32(pack_files.length);
    await outFile.writeInt32(1);

    const index_size = pack_files.reduce((acc, pack) => acc + pack.name.length + 1 + 5, 0);
    await outFile.writeInt32(61);
    await outFile.writeInt32(0x7fffffff); // header_buffer

    for (const pack_file of pack_files) {
      const { name, file_size, start_pos, is_compressed } = pack_file;
      console.log("file size is " + file_size);
      await outFile.writeInt32(file_size);
      await outFile.writeInt8(is_compressed);
      await outFile.writeString(name + "\0");
    }

    const getGUID = () => {
      const genRanHex = (size: number) =>
        [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
      return [genRanHex(8), genRanHex(4), genRanHex(4), genRanHex(4), genRanHex(12)].join("-");
    };

    const guid = getGUID();
    console.log("guid is " + guid);

    await outFile.write(Buffer.from([0xfd, 0xfe, 0xfc, 0xff])); // guid marker
    await outFile.writeInt16(guid.length);
    const twoByteGUID = guid
      .split("")
      .map((str) => str + "\0")
      .join("");
    console.log(twoByteGUID);
    await outFile.write(Buffer.from(twoByteGUID, "utf-8"));

    await outFile.write(Buffer.from([0xfc, 0xfd, 0xfe, 0xff])); // version marker
    await outFile.writeInt32(10); // db version
    await outFile.writeInt8(1);

    for (const pack_file of pack_files) {
      console.log("NUM OF FIELDS:");
      console.log(pack_file.schemaFields.length / ver_schema.length);
      await outFile.writeInt32(pack_file.schemaFields.length / ver_schema.length);
      for (const field of pack_file.schemaFields) {
        if (field.name === "general_unit") {
          const newField = clone(field);
          newField.fields[0].val = 1;
          await writeField(outFile, newField);
        } else {
          await writeField(outFile, field);
        }
      }
    }
  } catch (e) {
    console.log(e);
  } finally {
    await outFile.close();
  }
};

const writeField = async (file: BinaryFile, schemaField: SchemaField) => {
  // console.log(field);
  for (const field of schemaField.fields) {
    switch (field.type) {
      case "Int8":
        {
          await file.writeInt8(field.val as number);
        }
        break;
      case "Int16":
        {
          await file.writeUInt16(field.val as number);
        }
        break;
      case "String":
        {
          await file.writeString(field.val as string);
        }
        break;
      case "UInt8":
        {
          await file.writeUInt8(field.val as number);
        }
        break;
    }
  }
};

const readUTFString = async (fileIn: BinaryFile) => {
  const length = await fileIn.readInt16();
  // console.log('length is ' + length);
  // since utf8 is 2 bytes per char
  return (await fileIn.read(length * 2)).toString("utf8");
};

export const readPack = async (modName: string, modPath: string): Promise<Pack> => {
  const pack_files: PackedFile[] = [];

  let file: BinaryFile;
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

      while (null !== (chunk = headerBuffer.toString("ascii", bufPos, bufPos + 1))) {
        bufPos += 1;
        // terminatorIndex = chunk.indexOf(stringTerminator);
        if (chunk == "\0") {
          // chunks.push(chunk.subarray(0, terminatorIndex + 1));
          // name = Buffer.concat(chunks).toString("ascii");

          // chunks = [];
          // file.seek(file.tell() - (chunk.length - terminatorIndex));
          // chunks.push(chunk.subarray(terminatorIndex, chunk.length + 1));
          break;
        }
        // chunks.push(chunk);
        name += chunk;
        // console.log(`Read ${chunk.length} bytes of data...`);
      }

      // if (i === 1000) {
      // console.log(console.timeEnd("1000files"));
      // }
      // console.log("name is " + name);
      //   console.log("file_size is " + file_size);

      pack_files.push({
        name,
        file_size,
        start_pos: file_pos,
        is_compressed,
        schemaFields: [],
        version: undefined,
        guid: undefined,
      });
      file_pos += file_size;
    }

    // console.log("num pack files: " + pack_files.length);

    // console.log("DONE READING FILE");

    const pack_file = pack_files.find((pack) =>
      pack.name.startsWith("db\\units_custom_battle_permissions_tables")
    );

    if (pack_file) {
      // console.log(pack_file);

      file.seek(pack_file.start_pos);

      for (;;) {
        const marker = await file.read(4);
        // console.log(marker.toString("hex"));
        if (marker.toString("hex") === "fdfefcff") {
          const guid = await readUTFString(file);
          // console.log("guid is " + guid);
          pack_file.guid = guid;
        } else if (marker.toString("hex") === "fcfdfeff") {
          // console.log("found version marker");
          const version = await file.readInt32();
          pack_file.version = version;
          await file.read(1);
        } else {
          file.seek(file.tell() - 4);
          break;
        }
      }
      const entryCount = await file.readInt32();
      // console.log("entry count is " + entryCount);
      // console.log("pos is " + file.tell());

      // outFile.seek(file.tell());
      for (let i = 0; i < entryCount; i++) {
        for (const field of ver_schema) {
          const [name, type] = field;
          // console.log(name);
          // console.log(type);
          // if (name === 'general_unit') console.log("it's a general");
          // console.log("pos is " + outFile.tell());
          // console.log('i is ' + i);
          const fieldValues = await parseType(file, type);
          pack_file.schemaFields.push({
            name,
            type,
            fields: fieldValues,
          });
        }
      }
    }
  } catch (e) {
    console.log(e);
  } finally {
    await file.close();
  }

  // console.log(pack_files);

  return { name: modName, path: modPath, packedFiles: pack_files } as Pack;
};

export const readPackData = async (mods: Mod[]) => {
  // console.log("READ PACKS STARTED");
  const packFieldsPromises = mods.map((mod) => {
    return readPack(mod.name, mod.path);
  });

  const packFieldsSettled = await Promise.allSettled(packFieldsPromises);
  const newPacksData = (
    packFieldsSettled.filter((pfs) => pfs.status === "fulfilled") as PromiseFulfilledResult<Pack>[]
  ).map((r) => r.value);
  packsData.splice(0, packsData.length, ...newPacksData);

  console.log("READ PACKS DONE");
  // console.log("num packs: " + packsData.length);
};
