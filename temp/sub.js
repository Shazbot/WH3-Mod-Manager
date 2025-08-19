"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
Object.defineProperty(exports, "__esModule", { value: true });
var steamworks = require("steamworks.js");
var fs = require("fs");
if (process.argv[3] == "justRun") {
    console.log("justRun");
    steamworks.init(Number(process.argv[2]));
    setTimeout(function () {
        process.exit();
    }, 200);
}
if (process.argv[3] == "getSubscribedIds") {
    console.log("getSubscribedIds");
    var client = steamworks.init(Number(process.argv[2]));
    try {
        var items = client.workshop.getSubscribedItems();
        if (process.send)
            process.send(items.map(function (item) { return item.toString(); }));
    }
    catch (e) {
        /* empty */
    }
    setTimeout(function () {
        process.exit();
    }, 300);
}
if (process.argv[3] == "download") {
    console.log("download");
    var ids = process.argv[4].split(";"); //"2856936614";
    var client_1 = steamworks.init(Number(process.argv[2]));
    ids.forEach(function (id) { return __awaiter(void 0, void 0, void 0, function () {
        var success, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    success = client_1.workshop.download(BigInt(id), false);
                    if (process.send)
                        process.send("for id: " + success);
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 300); })];
                case 1:
                    _a.sent();
                    return [3 /*break*/, 3];
                case 2:
                    e_1 = _a.sent();
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    setTimeout(function () {
        process.exit();
    }, 300);
}
if (process.argv[3] == "unsubscribe") {
    console.log("unsubscribe");
    var ids = process.argv[4].split(";");
    var client_2 = steamworks.init(Number(process.argv[2]));
    ids.forEach(function (id) {
        try {
            client_2.workshop.unsubscribe(BigInt(id));
        }
        catch (e) {
            /* empty */
        }
    });
    setTimeout(function () {
        if (process.send)
            process.send("done");
        process.exit();
    }, 200);
}
if (process.argv[3] == "getItems") {
    console.log("getItems");
    var ids = process.argv[4].split(",").map(function (id) { return BigInt(id); });
    var client = steamworks.init(Number(process.argv[2]));
    if (!process.send) {
        process.exit();
    }
    client.workshop
        .getItems(ids)
        .then(function (data) {
        if (process.send)
            process.send(data.items
                .filter(function (data) { return data; })
                .map(function (data) {
                return data && __assign(__assign({}, data), { owner: __assign(__assign({}, data.owner), { steamId64: data === null || data === void 0 ? void 0 : data.owner.steamId64.toString() }), publishedFileId: data.publishedFileId.toString(), statistics: {
                        numSubscriptions: data.statistics.numSubscriptions
                            ? data.statistics.numSubscriptions.toString()
                            : "",
                        numFavorites: data.statistics.numFavorites ? data.statistics.numFavorites.toString() : "",
                        numFollowers: data.statistics.numFollowers ? data.statistics.numFollowers.toString() : "",
                        numUniqueSubscriptions: data.statistics.numUniqueSubscriptions
                            ? data.statistics.numUniqueSubscriptions.toString()
                            : "",
                        numUniqueFavorites: data.statistics.numUniqueFavorites
                            ? data.statistics.numUniqueFavorites.toString()
                            : "",
                        numUniqueFollowers: data.statistics.numUniqueFollowers
                            ? data.statistics.numUniqueFollowers.toString()
                            : "",
                        numUniqueWebsiteViews: data.statistics.numUniqueWebsiteViews
                            ? data.statistics.numUniqueWebsiteViews.toString()
                            : "",
                        reportScore: data.statistics.reportScore ? data.statistics.reportScore.toString() : "",
                        numSecondsPlayed: data.statistics.numSecondsPlayed
                            ? data.statistics.numSecondsPlayed.toString()
                            : "",
                        numPlaytimeSessions: data.statistics.numPlaytimeSessions
                            ? data.statistics.numPlaytimeSessions.toString()
                            : "",
                        numComments: data.statistics.numComments ? data.statistics.numComments.toString() : "",
                        numSecondsPlayedDuringTimePeriod: data.statistics.numSecondsPlayedDuringTimePeriod
                            ? data.statistics.numSecondsPlayedDuringTimePeriod.toString()
                            : "",
                        numPlaytimeSessionsDuringTimePeriod: data.statistics.numPlaytimeSessionsDuringTimePeriod
                            ? data.statistics.numPlaytimeSessionsDuringTimePeriod.toString()
                            : "",
                    } });
            }));
        setTimeout(function () {
            process.exit();
        }, 200);
    })
        .catch(function (e) {
        fs.appendFileSync("sublog.txt", "ERROR:");
        fs.appendFileSync("sublog.txt", e.toString());
        process.exit();
    });
}
if (process.argv[3] == "checkState") {
    console.log("checkState");
    var ids = process.argv[4].split(";"); //"2856936614";
    var client_3 = steamworks.init(Number(process.argv[2]));
    var idsThatNeedUpdates = ids
        .map(function (id) { return [id, client_3.workshop.state(BigInt(id))]; })
        .filter(function (num) { return num[1] & 8; })
        .map(function (num) { return num[0]; });
    idsThatNeedUpdates.forEach(function (id) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client_3.workshop.download(BigInt(id), false);
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 100); })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    var timeoutValue = (idsThatNeedUpdates.length > 0 && 200) || 0;
    setTimeout(function () {
        process.exit();
    }, timeoutValue);
}
if (process.argv[3] == "upload") {
    console.log("upload");
    var client = steamworks.init(Number(process.argv[2]));
    try {
        client.workshop.createItem(Number(process.argv[2])).then(function (data) {
            if (process.send)
                process.send({
                    type: "success",
                    workshopId: data.itemId.toString(),
                    needsToAcceptAgreement: data.needsToAcceptAgreement,
                });
            setTimeout(function () {
                process.exit();
            }, 300);
        });
    }
    catch (e) {
        if (process.send)
            process.send({ type: "error" });
        setTimeout(function () {
            process.exit();
        }, 300);
        console.log(e);
    }
}
if (process.argv[3] == "update") {
    console.log("update");
    var id_1 = process.argv[4]; //"2856936614";
    var path = process.argv[5]; //"2856936614";
    var previewPath = process.argv[6];
    var modTags = process.argv[7];
    var modTitle = process.argv.length > 8 && process.argv[8];
    var client_4 = steamworks.init(Number(process.argv[2]));
    fs.appendFileSync("sublog.txt", modTags.toString());
    console.log(id_1);
    console.log(path);
    var updateData = { contentPath: path, previewPath: previewPath, tags: modTags ? modTags.split(";") : ["mod"] };
    if (modTitle) {
        updateData.title = modTitle;
    }
    client_4.workshop.updateItemWithCallback(BigInt(id_1), updateData, Number(process.argv[2]), function (data) {
        if (process.send)
            process.send({
                type: "success",
                itemId: Number(data.itemId),
                needsToAcceptAgreement: data.needsToAcceptAgreement,
            });
        client_4.workshop.download(BigInt(id_1), false);
        setTimeout(function () {
            process.exit();
        }, 300);
    }, function (err) {
        if (process.send)
            process.send({ type: "error", err: err });
        setTimeout(function () {
            process.exit();
        }, 300);
    }, function (data) {
        if (process.send) {
            if (data.status == 3)
                process.send({
                    type: "progress",
                    status: data.status,
                    progress: Number(data.progress),
                    total: Number(data.total),
                });
        }
    }, 100);
}
if (process.argv[3] == "sub") {
    console.log("SUB");
    var ids = process.argv[4].split(";"); //"2856936614";
    var client_5 = steamworks.init(Number(process.argv[2]));
    var promises = ids.map(function (id) { return client_5.workshop.subscribe(BigInt(id)); });
    Promise.allSettled(promises).then(function () {
        setTimeout(function () {
            if (process.send)
                process.send("done");
            process.exit();
        }, 200);
    });
}
