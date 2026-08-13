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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
var steamworks = require("./../steamworks");
var fs = require("fs");
var WORKSHOP_STATE_INSTALLED = 4;
var WORKSHOP_STATE_NEEDS_UPDATE = 8;
var WORKSHOP_STATE_DOWNLOADING = 16;
var WORKSHOP_STATE_DOWNLOAD_PENDING = 32;
var WORKSHOP_UPDATE_POLL_INTERVAL_MS = 1000;
var WORKSHOP_UPDATE_RETRY_AFTER_MS = 30000;
var WORKSHOP_UPDATE_INACTIVITY_TIMEOUT_MS = 5 * 60000;
var appendSublog = function (message) {
    fs.appendFileSync("sublog.txt", "".concat(message, "\n"));
};
var logSteamError = function (operation, error, ids) {
    var _a;
    var itemIds = (_a = ids === null || ids === void 0 ? void 0 : ids.map(function (id) { return id.toString(); }).join(",")) !== null && _a !== void 0 ? _a : "";
    var suffix = itemIds ? " ids=".concat(itemIds) : "";
    var errorMessage = error instanceof Error ? error.message : String(error);
    appendSublog("ERROR ".concat(operation).concat(suffix, ": ").concat(errorMessage));
};
var parseItemIds = function (rawIds) {
    return (rawIds !== null && rawIds !== void 0 ? rawIds : "")
        .split(/[;,]/)
        .map(function (id) { return id.trim(); })
        .filter(function (id) { return id !== "" && /^\d+$/.test(id); })
        .map(function (id) { return BigInt(id); });
};
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
var getAuthors = function (client, ids, cb) {
    if (!process.send) {
        process.exit();
    }
    var authorsMap = new Map();
    var unknownAuthors = [];
    for (var _i = 0, ids_1 = ids; _i < ids_1.length; _i++) {
        var authorId = ids_1[_i];
        // Method 1: Use the convenience function (requests info and returns current name)
        var authorName = client.friends.getUserName(authorId);
        // If the name is "[unknown]", wait a bit for the download and try again
        if (authorName === "[unknown]") {
            unknownAuthors.push(authorId);
        }
        else {
            authorsMap.set(authorId.toString(), authorName);
        }
    }
    setTimeout(function () {
        for (var _i = 0, unknownAuthors_1 = unknownAuthors; _i < unknownAuthors_1.length; _i++) {
            var authorId = unknownAuthors_1[_i];
            var authorName = client.friends.getFriendPersonaName(authorId);
            authorsMap.set(authorId.toString(), authorName);
        }
        cb(authorsMap);
    }, 1500);
};
if (process.argv[3] == "getAuthors") {
    console.log("getAuthors");
    var ids = process.argv[4].split(",").map(function (id) { return BigInt(id); });
    var client = steamworks.init(Number(process.argv[2]));
    getAuthors(client, ids, function (authorsMap) {
        if (process.send)
            process.send(authorsMap);
        setTimeout(function () {
            process.exit();
        }, 200);
    });
}
var getDependencies = function (client, ids, cb) {
    if (!process.send) {
        process.exit();
    }
    var dependenciesMap = new Map();
    var promises = ids.map(function (id) {
        return new Promise(function (resolve) {
            client.workshop
                .getItemDependencies(id)
                .then(function (dependencyIds) {
                dependenciesMap.set(id.toString(), dependencyIds.map(function (depId) { return depId.toString(); }));
                resolve();
            })
                .catch(function (e) {
                dependenciesMap.set(id.toString(), []);
                logSteamError("getItemDependencies", e, [id]);
                resolve();
            });
        });
    });
    Promise.allSettled(promises).then(function () {
        cb(dependenciesMap);
    });
};
if (process.argv[3] == "getDependencies") {
    console.log("getDependencies");
    var ids = parseItemIds(process.argv[4]);
    var client = steamworks.init(Number(process.argv[2]));
    getDependencies(client, ids, function (dependenciesMap) {
        if (process.send)
            process.send(dependenciesMap);
        setTimeout(function () {
            process.exit();
        }, 200);
    });
}
var getItems = function (client, ids, cb) {
    if (!process.send) {
        process.exit();
    }
    if (ids.length === 0) {
        cb([]);
        return;
    }
    var stringifyItems = function (data) {
        return data.items
            .filter(function (data) { return data; })
            .map(function (data) {
            return data &&
                __assign(__assign({}, data), { owner: __assign(__assign({}, data.owner), { steamId64: data === null || data === void 0 ? void 0 : data.owner.steamId64.toString() }), publishedFileId: data.publishedFileId.toString(), statistics: {
                        numSubscriptions: data.statistics.numSubscriptions ? data.statistics.numSubscriptions.toString() : "",
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
                        numSecondsPlayed: data.statistics.numSecondsPlayed ? data.statistics.numSecondsPlayed.toString() : "",
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
        });
    };
    client.workshop
        .getItems(ids)
        .then(function (data) {
        cb(stringifyItems(data));
    })
        .catch(function (e) { return __awaiter(void 0, void 0, void 0, function () {
        var fallbackItems;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logSteamError("getItems.batch", e, ids);
                    return [4 /*yield*/, Promise.all(ids.map(function (id) { return __awaiter(void 0, void 0, void 0, function () {
                            var data, singleItemError_1;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, client.workshop.getItems([id])];
                                    case 1:
                                        data = _a.sent();
                                        return [2 /*return*/, stringifyItems(data)[0]];
                                    case 2:
                                        singleItemError_1 = _a.sent();
                                        logSteamError("getItems.single", singleItemError_1, [id]);
                                        return [2 /*return*/, undefined];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 1:
                    fallbackItems = _a.sent();
                    cb(fallbackItems.filter(function (item) { return item !== undefined; }));
                    return [2 /*return*/];
            }
        });
    }); });
};
if (process.argv[3] == "getModsData") {
    console.log("getModsData");
    var ids_2 = parseItemIds(process.argv[4]);
    var client_3 = steamworks.init(Number(process.argv[2]));
    getItems(client_3, ids_2, function (data) {
        getDependencies(client_3, ids_2, function (dependenciesMap) {
            var dedupedAuthorIds = Array.from(new Set(data.map(function (data) { return data.owner.steamId64; }))).map(function (id) { return BigInt(id); });
            getAuthors(client_3, dedupedAuthorIds, function (authorsMap) {
                var installInfoDiagnostics = data.map(function (item) {
                    try {
                        var workshopId = BigInt(item.publishedFileId);
                        var installInfo = client_3.workshop.installInfo(workshopId);
                        return {
                            workshopId: item.publishedFileId,
                            remoteTimestamp: item.timeUpdated,
                            installedTimestamp: installInfo === null || installInfo === void 0 ? void 0 : installInfo.timestamp,
                            state: client_3.workshop.state(workshopId),
                            installFolder: installInfo === null || installInfo === void 0 ? void 0 : installInfo.folder,
                            sizeOnDisk: installInfo === null || installInfo === void 0 ? void 0 : installInfo.sizeOnDisk.toString(),
                        };
                    }
                    catch (error) {
                        return {
                            workshopId: item.publishedFileId,
                            remoteTimestamp: item.timeUpdated,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                });
                var modsData = {
                    mods: data,
                    dependencies: Object.fromEntries(dependenciesMap),
                    authors: Object.fromEntries(authorsMap),
                    installInfoDiagnostics: installInfoDiagnostics,
                };
                if (process.send)
                    process.send(modsData);
                setTimeout(function () {
                    process.exit();
                }, 200);
            });
        });
    });
}
if (process.argv[3] == "checkState") {
    console.log("checkState");
    var ids_3 = parseItemIds(process.argv[4]);
    var expectedInstallTimestamps_1 = new Map(((_a = process.argv[5]) !== null && _a !== void 0 ? _a : "")
        .split(";")
        .map(function (entry) { return entry.split(":"); })
        .filter(function (entry) { return entry.length === 2 && /^\d+$/.test(entry[0]) && /^\d+$/.test(entry[1]); })
        .map(function (_a) {
        var workshopId = _a[0], timestamp = _a[1];
        return [workshopId, Number(timestamp)];
    }));
    var forceDownload_1 = process.argv[6] === "force";
    var client_4 = steamworks.init(Number(process.argv[2]));
    var sendUpdateCheckMessage_1 = function (message) {
        return new Promise(function (resolve) {
            if (!process.send) {
                resolve();
                return;
            }
            process.send(message, function (error) {
                if (error)
                    appendSublog("ERROR checkState.send: ".concat(error.message));
                resolve();
            });
        });
    };
    void (function () { return __awaiter(void 0, void 0, void 0, function () {
        var updateItems, retriedWorkshopIds, _i, ids_4, workshopId, initialState, installTimestampBefore, expectedInstallTimestamp, isExpectedVersionInstalled, isAlreadyDownloading, requestAccepted, startedAt, lastActivityAt, isPendingUpdate, elapsed, didUpdateProgress, _a, updateItems_1, item, workshopId, state, downloadInfo, installTimestamp, expectedInstallTimestamp, hasMeaningfulDownloadInfo, downloadedBytes, totalBytes, isDownloadActive, _b, updateItems_2, item;
        var _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    updateItems = [];
                    retriedWorkshopIds = new Set();
                    for (_i = 0, ids_4 = ids_3; _i < ids_4.length; _i++) {
                        workshopId = ids_4[_i];
                        try {
                            initialState = client_4.workshop.state(workshopId);
                            installTimestampBefore = (_c = client_4.workshop.installInfo(workshopId)) === null || _c === void 0 ? void 0 : _c.timestamp;
                            expectedInstallTimestamp = expectedInstallTimestamps_1.get(workshopId.toString());
                            isExpectedVersionInstalled = expectedInstallTimestamp != null &&
                                installTimestampBefore != null &&
                                installTimestampBefore >= expectedInstallTimestamp;
                            if (!forceDownload_1 && (initialState & WORKSHOP_STATE_NEEDS_UPDATE) === 0)
                                continue;
                            if (forceDownload_1 && isExpectedVersionInstalled) {
                                updateItems.push({
                                    workshopId: workshopId.toString(),
                                    initialState: initialState,
                                    finalState: initialState,
                                    status: "updated",
                                    requestAccepted: true,
                                    installTimestampBefore: installTimestampBefore,
                                    installTimestampAfter: installTimestampBefore,
                                });
                                continue;
                            }
                            isAlreadyDownloading = (initialState & (WORKSHOP_STATE_DOWNLOADING | WORKSHOP_STATE_DOWNLOAD_PENDING)) !== 0;
                            requestAccepted = isAlreadyDownloading || client_4.workshop.download(workshopId, true);
                            updateItems.push({
                                workshopId: workshopId.toString(),
                                initialState: initialState,
                                finalState: initialState,
                                status: isAlreadyDownloading ? "already-downloading" : requestAccepted ? "requested" : "request-failed",
                                requestAccepted: requestAccepted,
                                installTimestampBefore: installTimestampBefore,
                            });
                        }
                        catch (error) {
                            updateItems.push({
                                workshopId: workshopId.toString(),
                                initialState: 0,
                                finalState: 0,
                                status: "request-failed",
                                requestAccepted: false,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                    return [4 /*yield*/, sendUpdateCheckMessage_1({ type: "started", checkedCount: ids_3.length, items: updateItems })];
                case 1:
                    _e.sent();
                    startedAt = Date.now();
                    lastActivityAt = startedAt;
                    isPendingUpdate = function (item) {
                        return item.status === "requested" || item.status === "already-downloading" || item.status === "downloading";
                    };
                    _e.label = 2;
                case 2:
                    if (!updateItems.some(isPendingUpdate)) return [3 /*break*/, 6];
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, WORKSHOP_UPDATE_POLL_INTERVAL_MS); })];
                case 3:
                    _e.sent();
                    elapsed = Date.now() - startedAt;
                    didUpdateProgress = false;
                    for (_a = 0, updateItems_1 = updateItems; _a < updateItems_1.length; _a++) {
                        item = updateItems_1[_a];
                        if (!isPendingUpdate(item))
                            continue;
                        try {
                            workshopId = BigInt(item.workshopId);
                            state = client_4.workshop.state(workshopId);
                            downloadInfo = client_4.workshop.downloadInfo(workshopId);
                            installTimestamp = (_d = client_4.workshop.installInfo(workshopId)) === null || _d === void 0 ? void 0 : _d.timestamp;
                            expectedInstallTimestamp = expectedInstallTimestamps_1.get(item.workshopId);
                            hasMeaningfulDownloadInfo = downloadInfo != null && (downloadInfo.current > BigInt(0) || downloadInfo.total > BigInt(0));
                            if (item.finalState !== state) {
                                didUpdateProgress = true;
                                lastActivityAt = Date.now();
                            }
                            item.finalState = state;
                            if (downloadInfo) {
                                downloadedBytes = downloadInfo.current.toString();
                                totalBytes = downloadInfo.total.toString();
                                if (hasMeaningfulDownloadInfo &&
                                    (item.downloadedBytes !== downloadedBytes || item.totalBytes !== totalBytes)) {
                                    didUpdateProgress = true;
                                    lastActivityAt = Date.now();
                                }
                                if (hasMeaningfulDownloadInfo) {
                                    item.downloadedBytes = downloadedBytes;
                                    item.totalBytes = totalBytes;
                                }
                            }
                            if ((state & WORKSHOP_STATE_NEEDS_UPDATE) === 0 &&
                                (state & WORKSHOP_STATE_INSTALLED) !== 0 &&
                                (expectedInstallTimestamp == null ||
                                    (installTimestamp != null && installTimestamp >= expectedInstallTimestamp))) {
                                item.status = "updated";
                                item.installTimestampAfter = installTimestamp;
                                didUpdateProgress = true;
                                lastActivityAt = Date.now();
                                continue;
                            }
                            isDownloadActive = (state & (WORKSHOP_STATE_DOWNLOADING | WORKSHOP_STATE_DOWNLOAD_PENDING)) !== 0;
                            if (isDownloadActive && item.status !== "downloading") {
                                item.status = "downloading";
                                didUpdateProgress = true;
                                lastActivityAt = Date.now();
                            }
                            else if (!isDownloadActive && item.status === "downloading") {
                                item.status = "requested";
                                didUpdateProgress = true;
                            }
                            if (elapsed >= WORKSHOP_UPDATE_RETRY_AFTER_MS &&
                                !hasMeaningfulDownloadInfo &&
                                !retriedWorkshopIds.has(item.workshopId)) {
                                retriedWorkshopIds.add(item.workshopId);
                                item.retryAccepted = client_4.workshop.download(workshopId, true);
                                didUpdateProgress = true;
                                if (item.retryAccepted)
                                    lastActivityAt = Date.now();
                            }
                        }
                        catch (error) {
                            item.status = "request-failed";
                            item.error = error instanceof Error ? error.message : String(error);
                            didUpdateProgress = true;
                        }
                    }
                    if (Date.now() - lastActivityAt >= WORKSHOP_UPDATE_INACTIVITY_TIMEOUT_MS) {
                        for (_b = 0, updateItems_2 = updateItems; _b < updateItems_2.length; _b++) {
                            item = updateItems_2[_b];
                            if (isPendingUpdate(item)) {
                                item.status = "timed-out";
                                didUpdateProgress = true;
                            }
                        }
                    }
                    if (!didUpdateProgress) return [3 /*break*/, 5];
                    return [4 /*yield*/, sendUpdateCheckMessage_1({ type: "progress", checkedCount: ids_3.length, items: updateItems })];
                case 4:
                    _e.sent();
                    _e.label = 5;
                case 5: return [3 /*break*/, 2];
                case 6: return [4 /*yield*/, sendUpdateCheckMessage_1({ type: "finished", checkedCount: ids_3.length, items: updateItems })];
                case 7:
                    _e.sent();
                    process.exit(0);
                    return [2 /*return*/];
            }
        });
    }); })().catch(function (error) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, sendUpdateCheckMessage_1({
                        type: "finished",
                        checkedCount: ids_3.length,
                        items: [
                            {
                                workshopId: "unknown",
                                initialState: 0,
                                finalState: 0,
                                status: "request-failed",
                                requestAccepted: false,
                                error: error instanceof Error ? error.message : String(error),
                            },
                        ],
                    })];
                case 1:
                    _a.sent();
                    process.exit(1);
                    return [2 /*return*/];
            }
        });
    }); });
}
if (process.argv[3] == "getItems") {
    console.log("getItems");
    var ids = parseItemIds(process.argv[4]);
    var client = steamworks.init(Number(process.argv[2]));
    getItems(client, ids, function (data) {
        if (process.send)
            process.send(data);
        setTimeout(function () {
            process.exit();
        }, 200);
    });
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
    var client_5 = steamworks.init(Number(process.argv[2]));
    fs.appendFileSync("sublog.txt", modTags.toString());
    console.log(id_1);
    console.log(path);
    var updateData = { contentPath: path, previewPath: previewPath, tags: modTags ? modTags.split(";") : ["mod"] };
    if (modTitle) {
        updateData.title = modTitle;
    }
    client_5.workshop.updateItemWithCallback(BigInt(id_1), updateData, Number(process.argv[2]), function (data) {
        if (process.send)
            process.send({
                type: "success",
                itemId: Number(data.itemId),
                needsToAcceptAgreement: data.needsToAcceptAgreement,
            });
        client_5.workshop.download(BigInt(id_1), false);
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
    var client_6 = steamworks.init(Number(process.argv[2]));
    var promises = ids.map(function (id) { return client_6.workshop.subscribe(BigInt(id)); });
    Promise.allSettled(promises).then(function () {
        setTimeout(function () {
            if (process.send)
                process.send("done");
            process.exit();
        }, 200);
    });
}
