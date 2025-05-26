"use strict";
// FOR MULTITHREADED READING OF FILES, CURRENTLY NOT USED
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPack = void 0;
// eslint-disable-next-line @typescript-eslint/no-var-requires
var DBNameToDBVersions = require("./schema").DBNameToDBVersions;
// eslint-disable-next-line @typescript-eslint/no-var-requires
var _a = require("worker_threads"), workerData = _a.workerData, parentPort = _a.parentPort, isMainThread = _a.isMainThread;
// eslint-disable-next-line @typescript-eslint/no-var-requires
var BinaryFile = require("../node_modules/binary-file/");
// eslint-disable-next-line @typescript-eslint/no-var-requires
var nodePath = require("path");
// READING A PACK WITH A WORKER THREAD
// not used currently because we get cpu but the memory use spike is insane because it's duplicated when moved to main thread
function parseTypeBuffer(buffer, pos, type, existingFields) {
    var fields = existingFields || [];
    switch (type) {
        case "Boolean":
            {
                // console.log('boolean');
                var val = buffer.readUInt8(pos); //await file.readUInt8();
                pos += 1;
                fields.push({ type: "UInt8", val: val });
                return [fields, pos];
                // await outFile.writeInt8(newVal !== undefined ? newVal : val);
            }
            break;
        case "ColourRGB":
            {
                var val = buffer.readInt32LE(pos); // await file.readInt32();
                pos += 4;
                fields.push({ type: "I32", val: val });
                return [fields, pos];
            }
            break;
        case "StringU16":
            {
                try {
                    var length_1 = buffer.readInt16LE(pos); //await file.readInt16();
                    pos += 2;
                    var val = buffer.subarray(pos, pos + length_1 * 2).toString("utf8"); //(await file.read(length * 2)).toString("utf8");
                    pos += length_1 * 2;
                    fields.push({ type: "String", val: val });
                    return [fields, pos];
                }
                catch (e) {
                    console.log(e);
                    throw e;
                }
            }
            break;
        case "StringU8":
            {
                var length_2 = buffer.readUint16LE(pos); //await file.readUInt16();
                // console.log("stringU8 length is", length);
                pos += 2;
                var val = buffer.subarray(pos, pos + length_2).toString("ascii"); //await file.readString(length);
                pos += length_2;
                // console.log("val is", val);
                // console.log('string');
                // console.log('position is ' + file.tell());
                // const val = await read_string(file);
                // console.log(length);
                // console.log(val);
                fields.push({ type: "Int16", val: length_2 });
                fields.push({ type: "String", val: val });
                return [fields, pos];
                // await outFile.writeString(val + '\0');
                // await outFile.writeInt16(length);
                // await outFile.writeString(val);
            }
            break;
        case "OptionalStringU8":
            {
                var doesExist = buffer.readUint8(pos); // await file.readUInt8();
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
                var doesExist = buffer.readFloatLE(pos); //await file.readFloat();
                pos += 4;
                fields.push({ type: "F32", val: doesExist });
                return [fields, pos];
            }
            break;
        case "I32":
            {
                var doesExist = buffer.readInt32LE(pos); //await file.readInt32();
                pos += 4;
                fields.push({ type: "I32", val: doesExist });
                return [fields, pos];
            }
            break;
        case "F64":
            {
                var doesExist = buffer.readDoubleLE(pos); //await file.readDouble();
                pos += 8;
                fields.push({ type: "F64", val: doesExist });
                return [fields, pos];
            }
            break;
        case "I64":
            {
                var doesExist = Number(buffer.readBigInt64LE(pos)); //await file.readInt64();
                pos += 8;
                fields.push({ type: "I64", val: doesExist });
                return [fields, pos];
            }
            break;
        default:
            throw new Error("NO WAY TO RESOLVE " + type);
            break;
    }
}
var readUTFStringFromBuffer = function (buffer, pos) {
    var length = buffer.readInt16LE(pos);
    pos += 2;
    // console.log('length is ' + length);
    // since utf8 is 2 bytes per char
    return [buffer.subarray(pos, pos + length * 2).toString("utf8"), pos + length * 2];
};
var readPack = function (modPath_1) {
    var args_1 = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        args_1[_i - 1] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([modPath_1], args_1, true), void 0, function (modPath, skipParsingTables) {
        var pack_files, packHeader, file, header, byteMask, refFileCount, pack_file_index_size, pack_file_count, packed_file_index_size, dependencyPacks, header_buffer_len, header_buffer, chunk_1, bufPos_1, lastDependencyStart, packIndexBuffer, name_1, dataStart, chunk, file_pos, headerSize, headerBuffer, bufPos, i, name_2, file_size, is_compressed, nameStartPos, dbPackFiles, startPos, startOfLastPack_1, endPos, buffer, currentPos, _loop_1, _a, pack_files_1, pack_file, e_1;
        var _b, _c;
        if (skipParsingTables === void 0) { skipParsingTables = false; }
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    pack_files = [];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 18, 19, 22]);
                    file = new BinaryFile(modPath, "r", true);
                    return [4 /*yield*/, file.open()];
                case 2:
                    _d.sent();
                    return [4 /*yield*/, file.read(4)];
                case 3:
                    header = _d.sent();
                    if (header === null)
                        throw new Error("header missing");
                    return [4 /*yield*/, file.readInt32()];
                case 4:
                    byteMask = _d.sent();
                    return [4 /*yield*/, file.readInt32()];
                case 5:
                    refFileCount = _d.sent();
                    return [4 /*yield*/, file.readInt32()];
                case 6:
                    pack_file_index_size = _d.sent();
                    return [4 /*yield*/, file.readInt32()];
                case 7:
                    pack_file_count = _d.sent();
                    return [4 /*yield*/, file.readInt32()];
                case 8:
                    packed_file_index_size = _d.sent();
                    dependencyPacks = [];
                    header_buffer_len = 4;
                    return [4 /*yield*/, file.read(4)];
                case 9:
                    header_buffer = _d.sent();
                    packHeader = {
                        header: header,
                        byteMask: byteMask,
                        refFileCount: refFileCount,
                        pack_file_index_size: pack_file_index_size,
                        pack_file_count: pack_file_count,
                        header_buffer: header_buffer,
                    };
                    if (!(pack_file_index_size > 0)) return [3 /*break*/, 11];
                    bufPos_1 = 0;
                    lastDependencyStart = 0;
                    return [4 /*yield*/, file.read(pack_file_index_size)];
                case 10:
                    packIndexBuffer = _d.sent();
                    while (null !== (chunk_1 = packIndexBuffer.readInt8(bufPos_1))) {
                        bufPos_1 += 1;
                        if (chunk_1 == 0) {
                            name_1 = packIndexBuffer.toString("utf8", lastDependencyStart, bufPos_1 - 1);
                            dependencyPacks.push(name_1);
                            lastDependencyStart = bufPos_1;
                            // console.log(`found dep pack ${name}`);
                            if (bufPos_1 >= pack_file_index_size) {
                                break;
                            }
                        }
                    }
                    _d.label = 11;
                case 11:
                    dataStart = 24 + header_buffer_len + pack_file_index_size + packed_file_index_size;
                    chunk = void 0;
                    file_pos = dataStart;
                    headerSize = dataStart - file.tell();
                    return [4 /*yield*/, file.read(headerSize)];
                case 12:
                    headerBuffer = _d.sent();
                    bufPos = 0;
                    // console.log("pack_file_count is " + pack_file_count);
                    for (i = 0; i < pack_file_count; i++) {
                        name_2 = "";
                        file_size = headerBuffer.readInt32LE(bufPos);
                        bufPos += 4;
                        is_compressed = headerBuffer.readInt8(bufPos);
                        bufPos += 1;
                        nameStartPos = bufPos;
                        while (null !== (chunk = headerBuffer.readInt8(bufPos))) {
                            bufPos += 1;
                            if (chunk == 0) {
                                name_2 = headerBuffer.toString("utf8", nameStartPos, bufPos - 1);
                                break;
                            }
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
                            name: name_2,
                            file_size: file_size,
                            start_pos: file_pos,
                            // is_compressed,
                            schemaFields: [],
                            version: undefined,
                            guid: undefined,
                        });
                        file_pos += file_size;
                    }
                    dbPackFiles = pack_files.filter(function (packFile) {
                        var dbNameMatch = packFile.name.match(/^db\\(.*?)\\/);
                        return dbNameMatch != null && dbNameMatch[1];
                    });
                    if (skipParsingTables || dbPackFiles.length < 1) {
                        return [2 /*return*/, { name: nodePath.basename(modPath), path: modPath, packedFiles: pack_files, packHeader: packHeader }];
                    }
                    startPos = dbPackFiles.reduce(function (previous, current) { return (previous < current.start_pos ? previous : current.start_pos); }, Number.MAX_SAFE_INTEGER);
                    startOfLastPack_1 = dbPackFiles.reduce(function (previous, current) { return (previous > current.start_pos ? previous : current.start_pos); }, -1);
                    endPos = ((_c = (_b = dbPackFiles.find(function (packFile) { return packFile.start_pos === startOfLastPack_1; })) === null || _b === void 0 ? void 0 : _b.file_size) !== null && _c !== void 0 ? _c : 0) +
                        startOfLastPack_1;
                    return [4 /*yield*/, file.read(endPos - startPos, startPos)];
                case 13:
                    buffer = _d.sent();
                    currentPos = 0;
                    _loop_1 = function (pack_file) {
                        var dbNameMatch, dbName, dbversions, version, marker, readUTF, dbversion, entryCount, i, _e, _f, field, name_3, field_type, is_key, fieldsRet, fields, schemaField;
                        return __generator(this, function (_g) {
                            switch (_g.label) {
                                case 0:
                                    if (nodePath.basename(modPath) == "db.pack" &&
                                        !pack_file.name.startsWith("db\\units_custom_battle_permissions_tables\\"))
                                        return [2 /*return*/, "continue"];
                                    if (!dbPackFiles.find(function (iterPackFile) { return iterPackFile === pack_file; }))
                                        return [2 /*return*/, "continue"];
                                    currentPos = pack_file.start_pos - startPos;
                                    dbNameMatch = pack_file.name.match(/^db\\(.*?)\\/);
                                    if (dbNameMatch == null)
                                        return [2 /*return*/, "continue"];
                                    dbName = dbNameMatch[1];
                                    if (dbName == null)
                                        return [2 /*return*/, "continue"];
                                    dbversions = DBNameToDBVersions[dbName];
                                    if (!dbversions)
                                        return [2 /*return*/, "continue"];
                                    _g.label = 1;
                                case 1: return [4 /*yield*/, buffer.subarray(currentPos, currentPos + 4)];
                                case 2:
                                    marker = _g.sent();
                                    currentPos += 4;
                                    if (marker.toString("hex") === "fdfefcff") {
                                        readUTF = readUTFStringFromBuffer(buffer, currentPos);
                                        // console.log("guid is " + readUTF[0]);
                                        pack_file.guid = readUTF[0];
                                        currentPos = readUTF[1];
                                    }
                                    else if (marker.toString("hex") === "fcfdfeff") {
                                        // console.log("found version marker");
                                        version = buffer.readInt32LE(currentPos); // await file.readInt32();
                                        currentPos += 4;
                                        pack_file.version = version;
                                        // await file.read(1);
                                    }
                                    else {
                                        // console.log(marker.toString("hex"));
                                        currentPos -= 4;
                                        currentPos += 1;
                                        // file.seek(file.tell() - 4);
                                        return [3 /*break*/, 4];
                                    }
                                    _g.label = 3;
                                case 3: return [3 /*break*/, 1];
                                case 4:
                                    dbversion = dbversions.find(function (dbversion) { return dbversion.version == version; }) ||
                                        dbversions.find(function (dbversion) { return dbversion.version == 0; });
                                    if (!dbversion)
                                        return [2 /*return*/, "continue"];
                                    if (version != null && dbversion.version < version)
                                        return [2 /*return*/, "continue"];
                                    entryCount = buffer.readInt32LE(currentPos);
                                    currentPos += 4;
                                    i = 0;
                                    _g.label = 5;
                                case 5:
                                    if (!(i < entryCount)) return [3 /*break*/, 10];
                                    _e = 0, _f = dbversion.fields;
                                    _g.label = 6;
                                case 6:
                                    if (!(_e < _f.length)) return [3 /*break*/, 9];
                                    field = _f[_e];
                                    name_3 = field.name, field_type = field.field_type, is_key = field.is_key;
                                    return [4 /*yield*/, parseTypeBuffer(buffer, currentPos, field_type)];
                                case 7:
                                    fieldsRet = _g.sent();
                                    fields = fieldsRet[0];
                                    currentPos = fieldsRet[1];
                                    if (!fields[1] && !fields[0]) {
                                        console.log(name_3);
                                        console.log(field_type);
                                    }
                                    if (fields[0].val == undefined) {
                                        console.log(name_3);
                                        console.log(field_type);
                                    }
                                    if (fields.length == 0) {
                                        console.log(name_3);
                                        console.log(field_type);
                                    }
                                    schemaField = {
                                        // name,
                                        type: field_type,
                                        fields: fields,
                                        // isKey: is_key,
                                        // resolvedKeyValue: (is_key && fields[1] && fields[1].val.toString()) || fields[0].val.toString(),
                                    };
                                    if (is_key)
                                        schemaField.isKey = true;
                                    pack_file.schemaFields = pack_file.schemaFields || [];
                                    pack_file.schemaFields.push(schemaField);
                                    _g.label = 8;
                                case 8:
                                    _e++;
                                    return [3 /*break*/, 6];
                                case 9:
                                    i++;
                                    return [3 /*break*/, 5];
                                case 10: return [2 /*return*/];
                            }
                        });
                    };
                    _a = 0, pack_files_1 = pack_files;
                    _d.label = 14;
                case 14:
                    if (!(_a < pack_files_1.length)) return [3 /*break*/, 17];
                    pack_file = pack_files_1[_a];
                    return [5 /*yield**/, _loop_1(pack_file)];
                case 15:
                    _d.sent();
                    _d.label = 16;
                case 16:
                    _a++;
                    return [3 /*break*/, 14];
                case 17: return [3 /*break*/, 22];
                case 18:
                    e_1 = _d.sent();
                    console.log(e_1);
                    return [3 /*break*/, 22];
                case 19:
                    if (!file) return [3 /*break*/, 21];
                    return [4 /*yield*/, file.close()];
                case 20:
                    _d.sent();
                    _d.label = 21;
                case 21: return [7 /*endfinally*/];
                case 22: 
                // console.log("read " + modName);
                // const mod = toRead.find((iterMod) => modName === iterMod.name);
                // if (mod) {
                //   toRead.splice(toRead.indexOf(mod), 1);
                // }
                // console.log(toRead.map((mod) => mod.name));
                return [2 /*return*/, { name: nodePath.basename(modPath), path: modPath, packedFiles: pack_files, packHeader: packHeader }];
            }
        });
    });
};
exports.readPack = readPack;
if (!isMainThread) {
    if (workerData.checkCompat) {
        {
            // const packFileCollisions = findPackFileCollisions(workerData.packsData);
            // const packTableCollisions = findPackTableCollisions(workerData.packsData);
            // parentPort.postMessage({ packFileCollisions, packTableCollisions });
        }
    }
    else {
        try {
            var modPaths_1 = workerData.mods;
            var packFieldsPromises = modPaths_1.map(function (path) {
                return (0, exports.readPack)(path);
            });
            console.time("readPacks");
            Promise.allSettled(packFieldsPromises)
                .then(function (packFieldsSettled) {
                var newPacksData = packFieldsSettled.filter(function (pfs) { return pfs.status === "fulfilled"; })
                    .map(function (r) { return r.value; })
                    .filter(function (packData) { return packData; });
                //   packsData.splice(0, packsData.length, ...newPacksData);
                console.timeEnd("readPacks"); //26.580s
                // console.log(newPacksData[0]);
                if (newPacksData[0] == null) {
                    console.log("FAILED READING", modPaths_1[0]);
                }
                console.log("READ PACKS DONE");
                parentPort.postMessage(newPacksData[0]);
            })
                .catch(function (e) {
                console.log(e);
            });
        }
        catch (e) {
            console.log(e);
        }
    }
}
