'use strict'

const {
    Adapter,
    TextMessage,
    EnterMessage,
    LeaveMessage,
    User
} = require.main.require('hubot/es2015');

class AppMessage extends TextMessage {
    constructor(user, text, id, appid) {
        super(user, text, id)
        this.user = user;
        this.appid = appid;
        this.text = text;
        this.id = id;
    }
}

class Lark extends Adapter {
    #tenant_access_token;
    #expire;
    constructor(robot) {
        super(robot);
    }

    send(envelope, ...strings) {
        if (typeof strings[0] === 'object') {
            this.sendTextMessage(strings[0], {
                room: envelope.room,
                user: envelope.user.id,
            }).then((data) => {

            }).catch((err) => {
                this.robot.emit('error', err);
                //TODO retry
            });
        } else if (typeof strings[0] === 'string') {
            const cardBody = {
                elements: [{
                    tag: 'div',
                    text: {
                        tag: 'plain_text',
                        content: strings[0]
                    }
                }]
            }
            this.sendTextMessage(cardBody, {
                room: envelope.room,
                user: envelope.user.id,
            }).then((data) => {

            }).catch((err) => {
                this.robot.emit('error', err);
                //TODO retry
            });
        } else {
            this.robot.emit('error', 'Unsupported Message Type');
        }
    }

    reply(envelope, ...strings) {
        if (typeof strings[0] === 'object') {
            this.sendTextMessage(strings[0], {
                room: envelope.room,
                user: envelope.user.id,
                reply: envelope.message.id
            }).then((data) => {}).catch((err) => {
                this.robot.emit('error', err);
                //TODO retry
            });
        } else if (typeof strings[0] === 'string') {
            const cardBody = {
                elements: [{
                    tag: 'div',
                    text: {
                        tag: 'plain_text',
                        content: strings[0]
                    }
                }]
            }
            this.sendTextMessage(cardBody, {
                room: envelope.room,
                user: envelope.user.id,
                reply: envelope.message.id
            }).then((data) => {}).catch((err) => {
                this.robot.emit('error', err);
                //TODO retry
            });
        } else {
            this.robot.emit('error', 'Unsupported Message Type');
        }
    }

    run() {
        this.robot.logger.info(`[startup] Lark adapter in use`);
        this.robot.logger.info(`[startup] Respond to name: ${this.robot.name}`);

        this.robot.error((err, res) => {
            this.robot.logger.error(err);
        });

        const authRequest = this.authRequest.bind(this.robot);
        this.robot.router.post('/hubot/subscribe', (req, res) => {
            try {
                this.robot.logger.info(`[debug] Lark msg: ${req.body}`);
                const data = authRequest(req);
                if (data) {
                    const msgType = data.type;
                    switch (msgType) {
                        case 'url_verification':
                            res.send({
                                challenge: data.challenge
                            });
                            break;
                        case 'event_callback':
                            const eventType = data.event.type;
                            if (eventType === 'message') {
                                const user = new User(data.event.open_id);
                                if (data.event.chat_type === 'group') {
                                    user.room = data.event.open_chat_id;
                                }
                                const message = new AppMessage(
                                    user,
                                    `spaceship ${data.event.text_without_at_bot}`,
                                    data.event.open_message_id,
                                    data.event.app_id);
                                this.robot.receive(message);
                            } else if (eventType === 'add_user_to_chat') {
                                data.event.users.forEach(u => {
                                    const user = new User(u.open_id, {
                                        room: data.event.chat_id,
                                        name: u.Name ? u.Name : u.name
                                    });
                                    const message = new EnterMessage(user, null, data.uuid);
                                    this.robot.receive(message);
                                });
                            } else if (eventType === 'remove_user_from_chat') {
                                data.event.users.forEach(u => {
                                    const user = new User(u.open_id, {
                                        room: data.event.chat_id,
                                        name: u.Name ? u.Name : u.name
                                    });
                                    const message = new LeaveMessage(user, null, data.uuid);
                                    this.robot.receive(message);
                                });
                            } else if (eventType === 'user_status_change') {
                                this.robot.logger.info(data.event.current_status);
                                this.robot.logger.info(data.event.before_status);
                                if (data.event.current_status.is_active && data.event.before_status.is_active != data.event.current_status.is_active) {
                                    this.getUserInfo(data.event.open_id).then((user) => {
                                        this.robot.logger.info(user);
                                        this.robot.emit('lark_user_active', user);
                                    }).catch((err) => {
                                        this.robot.emit('error', err);
                                    });
                                } else if (data.event.current_status.is_resigned) {
                                    this.getUserInfo(data.event.open_id).then((user) => {
                                        this.robot.logger.info(user);
                                        this.robot.emit('lark_user_resigned', user);
                                    }).catch((err) => {
                                        this.robot.emit('error', err);
                                    });
                                }
                            }
                            res.send('ok');
                            break;
                        default:
                            res.sendStatus(404);
                    }
                } else {
                    res.sendStatus(401);
                }
            } catch (e) {
                this.robot.emit('error', e);
            }
        });

        this.robot.router.get('/ping', (req, res) => {
            res.send('pong');
        });

        this.emit('connected');
        this.robot.logger.info(`[startup] connected`);
    }

    authRequest(req) {
        try {
            const data = req.body.payload ? JSON.parse(req.body.payload) : req.body;
            if (data.token != process.env.LARK_EVENT_VERIFICATION_TOKEN) {
                this.emit('error', 'Auth Error');
                return null;
            }
            return data;
        } catch (e) {
            this.emit('error', `Auth Error ${e}`);
        }
        return null;
    }

    getTenantToken() {
        return new Promise((resolve, reject) => {
            if (this.#tenant_access_token && Date.now() < this.#expire) {
                resolve(this.#tenant_access_token);
            } else {
                const authData = JSON.stringify({
                    app_id: process.env.LARK_APP_ID,
                    app_secret: process.env.LARK_APP_SECRET,
                });
                this.robot.http('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/')
                    .header('Content-Type', 'application/json')
                    .post(authData)((err, response, body) => {
                        if (err)
                            reject(`GetTenantToken Error ${JSON.stringify(err)}`);
                        else if (response.statusCode == 200) {
                            const data = JSON.parse(body);
                            if (data.code == 0) {
                                this.#tenant_access_token = data.tenant_access_token;
                                this.#expire = Date.now() + data.expire * 1000 - 300000;
                                resolve(this.#tenant_access_token);
                            } else {
                                reject(`GetTenantToken Error ${data.code} ${data.msg}`);
                            }
                        } else {
                            reject(`GetTenantToken Error ${response.statusCode} ${body}`);
                        }
                    });
            }
        });
    }

    getUserInfo(openId) {
        return new Promise(async (resolve, reject) => {
            const token = await this.getTenantToken();
            this.robot.http(`https://open.feishu.cn/open-apis/contact/v1/user/batch_get?open_ids=${openId}`)
                .header('Content-Type', 'application/json')
                .header('Authorization', `Bearer ${token}`)
                .get()((err, response, body) => {
                    if (err)
                        reject(`GetUserInfo Error ${JSON.stringify(err)}`);
                    else if (response.statusCode == 200) {
                        const data = JSON.parse(body);
                        if (data.code == 0) {
                            resolve(data.data.user_infos[0]);
                        } else {
                            reject(`GetUserInfo Error ${data.code} ${data.msg}`);
                        }
                    } else {
                        reject(`GetUserInfo Error ${response.statusCode} ${body}`);
                    }
                });
        });
    }

    getBotInfo() {
        return new Promise(async (resolve, reject) => {
            const token = await this.getTenantToken();
            this.robot.http('https://open.feishu.cn/open-apis/bot/v3/info/')
                .header('Content-Type', 'application/json')
                .header('Authorization', `Bearer ${token}`)
                .get()((err, response, body) => {
                    if (err)
                        reject(`GetBotInfo Error ${JSON.stringify(err)}`);
                    else if (response.statusCode == 200) {
                        const data = JSON.parse(body);
                        if (data.code == 0) {
                            resolve(data.bot);
                        } else {
                            reject(`GetBotInfo Error ${data.code} ${data.msg}`);
                        }
                    } else {
                        reject(`GetBotInfo Error ${response.statusCode} ${body}`);
                    }
                });
        });
    }
    getRoleList() {
        return new Promise(async (resolve, reject) => {
            const token = await this.getTenantToken();
            this.robot.http('https://open.feishu.cn/open-apis/contact/v2/role/list')
                .header('Content-Type', 'application/json')
                .header('Authorization', `Bearer ${token}`)
                .get()((err, response, body) => {
                    if (err)
                        reject(`GetRoleList Error ${JSON.stringify(err)}`);
                    else if (response.statusCode == 200) {
                        const data = JSON.parse(body);
                        if (data.code == 0) {
                            resolve(data.data.role_list);
                        } else {
                            reject(`GetRoleList Error ${data.code} ${data.msg}`);
                        }
                    } else {
                        reject(`GetRoleList Error ${response.statusCode} ${body}`);
                    }
                });
        });
    }

    clearRoleCache(role_id) {
        this.robot.brain.remove(`role:${role_id}`);
    }

    isRole(open_id, role_id) {
        return new Promise(async (resolve, reject) => {
            const user_list = this.robot.brain.get(`role:${role_id}`);
            if (user_list) {
                const len = user_list.length;
                for (let i = 0; i < len; i++) {
                    if (user_list[i].open_id === open_id) {
                        resolve(true);
                        return;
                    }
                }
                resolve(false);
            } else {
                const token = await this.getTenantToken();
                this.robot.http(`https://open.feishu.cn/open-apis/contact/v2/role/members?role_id=${role_id}&page_size=50`)
                    .header('Content-Type', 'application/json')
                    .header('Authorization', `Bearer ${token}`)
                    .get()((err, response, body) => {
                        if (err)
                            reject(`IsRole Error ${JSON.stringify(err)}`);
                        else if (response.statusCode == 200) {
                            const data = JSON.parse(body);
                            if (data.code == 0) {
                                this.robot.brain.set(`role:${role_id}`, data.data.user_list);
                                const len = data.data.user_list ? data.data.user_list.length : 0;
                                for (let i = 0; i < len; i++) {
                                    if (data.data.user_list[i].open_id === open_id) {
                                        resolve(true);
                                        return;
                                    }
                                }
                                resolve(false);
                            } else {
                                reject(`IsRole Error ${data.code} ${data.msg}`);
                            }
                        } else {
                            reject(`IsRole Error ${response.statusCode} ${body}`);
                        }
                    });
            }
        });
    }

    sendTextMessage(msgBody, {
        user,
        room,
        reply
    }) {
        return new Promise(async (resolve, reject) => {
            const token = await this.getTenantToken();
            const cardMsg = {
                msg_type: 'interactive',
                card: msgBody
            }
            if (room) {
                cardMsg.chat_id = room;
            }
            if (user) {
                cardMsg.open_id = user;
            }
            if (reply) {
                cardMsg.root_id = reply;
            }
            this.robot.http('https://open.feishu.cn/open-apis/message/v4/send/')
                .header('Content-Type', 'application/json')
                .header('Authorization', `Bearer ${token}`)
                .post(JSON.stringify(cardMsg))((err, response, body) => {
                    if (err)
                        reject(`SendTextMessage Error ${JSON.stringify(err)}`);
                    else if (response.statusCode == 200) {
                        const data = JSON.parse(body);
                        if (data.code == 0) {
                            resolve(data.data);
                        } else {
                            reject(`SendTextMessage Error ${data.code} ${data.msg}`);
                        }
                    } else {
                        reject(`SendTextMessage Error ${response.statusCode} ${body}`);
                    }
                });
        });
    }
}

exports.use = (robot) => new Lark(robot);