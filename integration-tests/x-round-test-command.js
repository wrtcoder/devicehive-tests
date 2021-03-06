var async = require('async');
var assert = require('assert');
var utils = require('./common/utils');
var path = require('./common/path');
var req = require('./common/request');
var Websocket = require('./common/websocket');
var getRequestId = utils.core.getRequestId;

describe('Round tests for command', function () {
    this.timeout(60000);
    var url = null;

    var INTERVAL = 1000;
    var TOTAL_COMMANDS = 10;

    var COMMAND = utils.getName('round-command');
    var DEVICE = utils.getName('round-cmd-device');

    var commands = [];

    var deviceDef = {
        name: DEVICE,
        status: 'Online',
        data: {a: '1', b: '2'},
        network: {
            name: utils.getName('round-cmd-network'),
            description: 'lorem ipsum dolor sit amet'
        },
        deviceClass: {
            name: DEVICE,
            version: '1',
            isPermanent: true,
            offlineTimeout: 1234,
            data: {c: '3', d: '4'},
            equipment: [{
                name: "_integr-test-eq",
                code: "321",
                type: "_integr-test-type",
                data: {e: '5', f: '6'}
            }]
        }
    };
    var deviceId = utils.getName('round-cmd-device-id');
    var networkId = null;

    var user = null;
    var accessKey = null;

    var deviceConn = null;
    var clientConn = null;

    before(function (done) {

        function initCommands(callback) {

            for (var i = 0; i < TOTAL_COMMANDS; i++) {
                commands.push({
                    command: COMMAND,
                    parameters: {a: (i + 1), b: (i + 2)},
                    status: 'in progress ' + (i + 1)
                })
            }

            callback();
        }

        function getWsUrl(callback) {
            req.get(path.INFO).params({user: utils.admin}).send(function (err, result) {
                if (err) {
                    return callback(err);
                }
                url = result.webSocketServerUrl;
                callback();
            });
        }

        function createDevice(callback) {
            req.update(path.get(path.DEVICE, deviceId))
                .params({user: utils.admin, data: deviceDef})
                .send(function (err) {
                    if (err) {
                        return callback(err);
                    }

                    req.get(path.get(path.DEVICE, deviceId))
                        .params({user: utils.admin})
                        .send(function (err, result) {
                            if (err) {
                                return callback(err);
                            }

                            networkId = result.network.id;
                            callback();
                        })
                });
        }

        function createUser(callback) {
            utils.createUser2(1, networkId, function (err, result) {
                if (err) {
                    return callback(err);
                }

                user = result.user;
                callback();
            });
        }

        function createAccessKey(callback) {
            var args = {
                label: utils.getName('ws-access-key'),
                actions: [
                    'GetDeviceCommand',
                    'CreateDeviceCommand',
                    'UpdateDeviceCommand'
                ],
                networkIds: networkId
            };
            utils.accessKey.create(utils.admin, args.label, args.actions, void 0, args.networkIds,
                function (err, result) {
                    if (err) {
                        return callback(err);
                    }

                    accessKey = result.key;
                    callback();
                })
        }

        function createDeviceConn(callback) {
            deviceConn = new Websocket(url, 'device');
            deviceConn.connect(callback);
        }

        function authenticateDeviceConn(callback) {
            deviceConn.params({
                    action: 'authenticate',
                    requestId: getRequestId(),
                    deviceId: deviceId,
                    accessKey: accessKey
                })
                .send(callback);
        }

        function createClientConn(callback) {
            clientConn = new Websocket(url, 'client');
            clientConn.connect(callback);
        }

        function authenticateClientConn(callback) {
            clientConn.params({
                    action: 'authenticate',
                    requestId: getRequestId(),
                    accessKey: accessKey
                })
                .send(callback);
        }

        async.series([
            initCommands,
            getWsUrl,
            createDevice,
            createUser,
            createAccessKey,
            createDeviceConn,
            authenticateDeviceConn,
            createClientConn,
            authenticateClientConn
        ], done);
    });

    describe('#WS client -> WS device', function () {

        before(function (done) {
            deviceConn.params({
                    action: 'command/subscribe',
                    requestId: getRequestId()
                })
                .send(done);
        });

        function runTestDelayed(command, done) {
            setTimeout(function () {
                runTest(command, done);
            }, INTERVAL);
        }

        function runTest(command, done) {

            function sendCommand(callback) {

                deviceConn.waitFor('command/insert', callback)
                    .expect({
                        action: 'command/insert',
                        command: command
                    });

                clientConn.params({
                        action: 'command/insert',
                        requestId: getRequestId(),
                        deviceGuid: deviceId,
                        command: command
                    })
                    .send();
            }

            function sendReply(cmnd, callback) {

                var update = {
                    command: COMMAND,
                    lifetime: 100500,
                    status: 'updated',
                    result: {done: 'yes'}
                };

                clientConn.waitFor('command/update', callback)
                    .expect({
                        action: 'command/update',
                        command: update
                    });

                deviceConn.params({
                        action: 'command/update',
                        requestId: getRequestId(),
                        deviceGuid: deviceId,
                        commandId: cmnd.command.id,
                        command: update
                    })
                    .send();
            }

            async.waterfall([
                sendCommand,
                sendReply
            ], done);
        }

        it('WS client, access key auth -> WS device, device auth', function (done) {
            async.eachSeries(commands, runTestDelayed, done);
        });

        after(function (done) {
            deviceConn.params({
                    action: 'command/unsubscribe',
                    requestId: getRequestId()
                })
                .send(done);
        });
    });

    describe('#REST client -> WS device', function () {

        var createPath = null;

        before(function (done) {

            createPath = path.COMMAND.get(deviceId);

            deviceConn.params({
                    action: 'command/subscribe',
                    requestId: getRequestId()
                })
                .send(done);
        });

        function runTestDelayed(command, done) {
            setTimeout(function () {
                runTest(command, done);
            }, INTERVAL);
        }

        function runTest(command, done) {

            function sendCommand(callback) {
                
                deviceConn.waitFor('command/insert', callback)
                    .expect({
                        action: 'command/insert',
                        command: command
                    });

                req.create(createPath)
                    .params({ user: user, data: command })
                    .send();
            }

            function sendReply(cmnd, callback) {

                var waitPath = path.combine(createPath, cmnd.command.id, path.POLL);

                var update = {
                    command: COMMAND,
                    lifetime: 100500,
                    status: 'updated',
                    result: {done: 'yes'}
                };

                req.get(waitPath)
                    .params({user: user})
                    .expect(update)
                    .send(callback);

                setTimeout(function () {
                    deviceConn.params({
                            action: 'command/update',
                            requestId: getRequestId(),
                            deviceGuid: deviceId,
                            commandId: cmnd.command.id,
                            command: update
                        })
                        .send();
                }, 500);
            }

            async.waterfall([
                sendCommand,
                sendReply
            ], done);
        }

        it('REST client, user auth -> WS device, device auth', function (done) {
            async.eachSeries(commands, runTestDelayed, done);
        });

        after(function (done) {
            deviceConn.params({
                    action: 'command/unsubscribe',
                    requestId: getRequestId()
                })
                .send(done);
        });
    });

    describe('#WS client -> REST device', function () {

        var $path = null;
        var pollPath = null;

        before(function () {
            $path = path.COMMAND.get(deviceId);
            pollPath = path.combine($path, path.POLL);
        });

        function runTestDelayed(command, done) {
            setTimeout(function () {
                runTest(command, done);
            }, INTERVAL);
        }

        function runTest(command, done) {

            function sendCommand(callback) {

                req.get(pollPath)
                    .params({
                        accessKey:accessKey
                    })
                    .query('names', COMMAND)
                    .expect([command])
                    .send(callback);

                setTimeout(function () {
                    clientConn.params({
                            action: 'command/insert',
                            requestId: getRequestId(),
                            deviceGuid: deviceId,
                            command: command
                        })
                        .send();
                }, 500);
            }

            function sendReply(commands, callback) {

                var cmnd = commands[0];
                var update = {
                    command: COMMAND,
                    lifetime: 100500,
                    status: 'updated',
                    result: {done: 'yes'}
                };

                clientConn.waitFor('command/update', 4000, callback)
                    .expect({
                        action: 'command/update',
                        command: update
                    });

                var updatePath = path.get($path, cmnd.id);
                req.update(updatePath)
                    .params({
                        accessKey:accessKey,
                        data: update
                    })
                    .send();
            }

            async.waterfall([
                sendCommand,
                sendReply
            ], done);
        }

        it('WS client, access key auth -> REST device, device auth', function (done) {
            async.eachSeries(commands, runTestDelayed, done);
        });
    });

    describe('#REST client -> REST device', function () {

        var clientAuth = null;
        var deviceAuth = null;

        var createPath = null;
        var pollPath = null;

        before(function () {
            createPath = path.COMMAND.get(deviceId);
            pollPath = path.combine(createPath, path.POLL);
        });

        function runTestDelayed(command, done) {
            setTimeout(function () {
                runTest(command, done);
            }, INTERVAL);
        }

        function runTest(command, done) {

            function sendCommand(callback) {

                req.get(pollPath)
                    .params(utils.core.clone(deviceAuth))
                    .query('names', COMMAND)
                    .expect([command])
                    .send(callback);

                setTimeout(function () {
                    var params = utils.core.clone(clientAuth);
                    params.data = command;
                    req.create(createPath)
                        .params(params)
                        .send();
                }, 1000);
            }

            function sendReply(commands, callback) {

                var cmnd = commands[0];
                var waitPath = path.combine(createPath, cmnd.id, path.POLL);

                var update = {
                    command: COMMAND,
                    lifetime: 100500,
                    status: 'updated',
                    result: {done: 'yes'}
                };

                req.get(waitPath)
                    .params(utils.core.clone(clientAuth))
                    .expect(update)
                    .send(callback);

                setTimeout(function () {
                    var updatePath = path.get(createPath, cmnd.id);
                    var params = utils.core.clone(deviceAuth);
                    params.data = update;
                    req.update(updatePath)
                        .params(params)
                        .send();
                }, 1000);
            }

            async.waterfall([
                sendCommand,
                sendReply
            ], done);
        }

        it('REST client, access key auth -> REST device, access key auth', function (done) {
            clientAuth = {accessKey: accessKey};
            deviceAuth = {accessKey: accessKey};
            async.eachSeries(commands, runTestDelayed, done);
        });


        it('REST client, user auth -> REST device, access key auth', function (done) {
            clientAuth = {user: user};
            deviceAuth = {accessKey: accessKey};
            async.eachSeries(commands, runTestDelayed, done);
        });
    });

    after(function (done) {
        clientConn.close();
        deviceConn.close();
        utils.clearData(done);
    });
});
