import * as mysql from "mysql2";
import bcrypt from "bcryptjs";

/**
 * Hashes the value with 8 salt cycles.
 */
function hash(val: string) {
    return new Promise((resolve, reject) => {
        bcrypt.hash(val, 8, function (err, hash) {
            if (err) {
                reject(err);
            } else {
                resolve(hash);
            }
        });
    });
}

/**
 * The promise resolves either boolean or fails.
 */
function compare(value: string, hashed: string) {
    return new Promise((resolve, reject) => {
        bcrypt.compare(value, hashed, function (err, res) {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

const tokenValidityPeriod = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

export const connect = () => {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);

    const authUser = async (token: string) => {
        const userQuery = (await connection.promise().query(`SELECT username, token_created_at, admin, id FROM users WHERE token = UUID_TO_BIN(?)`, [token]).catch(err => {
            console.error("Failed to authenticate " + token + " with err: " + err);
            return [[false]];
        }))[0][0];
        if (!userQuery) {
            return {
                success: false,
                message: "Invalid user token"
            };
        } else {
            const tokenCreationTime = new Date(userQuery.token_created_at).getTime();
            const currentTime = new Date().getTime();
            const tokenAge = currentTime - tokenCreationTime;

            if (tokenAge > tokenValidityPeriod) {
                return {
                    success: false,
                    message: "Token has expired"
                };
            }

            return {
                success: true,
                user: userQuery
            }
        }

    }

    const self = {
        login: async (username: string, password: string) => {
            const userQuery = (await connection.promise().query(`SELECT username, password, icon_url, id FROM users WHERE username = ?`, [username]))[0][0];
            if (!userQuery || !userQuery.username || !userQuery.password) {
                return {
                    success: false,
                    message: "Uživatel s tímto uživatelským jménem neexistuje"
                }
            }

            if (!await compare(password, userQuery.password).then(res => res, err => {
                console.error(err);
                return false;
            })) {
                return {
                    success: false,
                    message: "Špatné heslo"
                }
            }

            const token = crypto.randomUUID();
            const userId = userQuery.id;

            await connection.promise().query(
                `UPDATE users SET token = UUID_TO_BIN(?), token_created_at = NOW() WHERE id = ?`,
                [token, userId]
            );

            connection.promise().end();

            return {
                username: userQuery.username,
                avatar: userQuery.icon_url,
                token: token,
                success: true
            }
        },
        register: async (username: string, password: string) => {
            // Check if username exists
            const exists = (await connection.promise().query(`SELECT COUNT(1) FROM users WHERE username = ?`, [username]))[0][0]["count(1)"];
            if (exists) {
                return {
                    success: false,
                    message: "Uživatel s tímto jménem již existuje"
                }
            }

            const hashedPassword = await hash(password).then((hash) => hash, (err) => {
                console.error(err);
                return null;
            });

            let token;

            if (hashedPassword) {
                token = crypto.randomUUID();
                await connection.promise().query(`INSERT INTO users (username, password, token) VALUES (?, ?, UUID_TO_BIN(?))`, [username, hashedPassword, token]);
            }

            connection.promise().end();

            return responseJSON(hashedPassword != null, () => {
                return {
                    token: token,
                }
            }, "Interní chyba");
        },
        createLesson: async (type: number, czech: string, polish: string, explanation: string, group: string) => {
            try {
                await connection.promise().query(`INSERT INTO lessons (type, czech, polish, explanation, \`group\`) VALUES (?, ?, ?, ?, ?)`, [type, czech, polish, explanation, group]);
                connection.promise().end();
                return {
                    success: true
                }
            } catch (err) {
                return {
                    success: false
                };
            }
        },
        getLessons: async (selector: string, noEnd?: boolean) => {
            // parse selector
            // * / group #id
            let lessons: any;
            if (selector.includes("*"))
                lessons = await connection.promise().query("SELECT * FROM lessons");
            else if (selector.startsWith("#")) {
                lessons = await connection.promise().query("SELECT * FROM lessons WHERE \`id\` = ?", [selector.substring(1)]);
            } else
                lessons = await connection.promise().query(`SELECT * FROM lessons WHERE \`group\` = ?`, [selector]);

            if (!noEnd)
                connection.promise().end();

            return {
                success: true,
                lessons: lessons[0]
            }
        },
        verifyLesson: async (token: string, lesson_id: number, polish: string) => {
            const auth = await authUser(token);
            if (!auth.success)
                return auth;

            const user = auth.user;
            const lessons = await self.getLessons("#" + lesson_id, true);


            if (!lessons.success || !lessons.lessons[0]) {
                return {
                    success: false,
                    message: "Lesson not found"
                };
            }

            const lesson = lessons.lessons[0];

            if (lesson.polish.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() !=
                polish.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()) {
                return {
                    success: false,
                    message: "Incorrect answer",
                };
            }

            connection.promise().query(`
    INSERT INTO lpu (\`user_id\`, \`lesson_id\`, \`group\`)
    SELECT ?, ?, ?
    WHERE NOT EXISTS (
        SELECT \`user_id\` FROM lpu
        WHERE \`user_id\` = ?
        AND \`group\` = ?
        AND \`lesson_id\` = ?
    )
    `,
                [user.id, lesson.id, lesson.group, user.id, lesson.group, lesson.id]).finally(() => {
                    connection.promise().end();
                });

            return {
                success: true,
                lesson: lesson,
            };
        },
        getUser: async (token) => {
            try {
                const [rows] = await connection.promise().query(`
                    SELECT id, username, icon_url, admin 
                    FROM users 
                    WHERE token = UUID_TO_BIN(?)
                `, [token]);

                connection.promise().end();

                // @ts-ignore
                if (rows.length > 0) {
                    const user = rows[0];
                    return {
                        success: true,
                        id: user.id,
                        username: user.username,
                        icon_url: user.icon_url,
                        admin: user.admin
                    };
                } else {
                    return {
                        success: false,
                        message: "User not found"
                    };
                }
            } catch (err) {
                console.error("Error getting user:", err);
                return {
                    success: false,
                    message: "Error getting user"
                };
            }
        },
        getAvatarByUsername: async (username) => {
            try {
                const [rows] = await connection.promise().query(`
                    SELECT icon_url 
                    FROM users 
                    WHERE username = ?
                `, [username]);

                connection.promise().end();

                // @ts-ignore
                if (rows.length > 0) {
                    return {
                        success: true,
                        avatar: rows[0].icon_url
                    };
                } else {
                    return {
                        success: false,
                        message: "User not found"
                    };
                }
            } catch (err) {
                console.error("Error getting avatar:", err);
                return {
                    success: false,
                    message: "Error getting avatar"
                };
            }
        },
        updateUsernameByToken: async (token, newUsername) => {
            try {
                await connection.promise().query(`
                    UPDATE users 
                    SET username = ?
                    WHERE token = UUID_TO_BIN(?)
                `, [newUsername, token]);

                connection.promise().end();

                return {
                    success: true
                };
            } catch (err) {
                console.error(err);
                return {
                    success: false,
                    message: "Error updating username"
                };
            }
        },
        updateAvatarByToken: async (token, newURL) => {
            try {
                await connection.promise().query(`
                    UPDATE users 
                    SET icon_url = ?
                    WHERE token = UUID_TO_BIN(?)
                `, [newURL, token]);

                connection.promise().end();

                return {
                    success: true
                };
            } catch (err) {
                console.error(err);
                return {
                    success: false,
                    message: "Error updating username"
                };
            }
        },
        updatePasswordByToken: async (token, newPassword) => {
            try {
                const hashedPassword = await hash(newPassword).then((hash) => hash, (err) => {
                    console.error(err);
                    return null;
                });

                let success = false;

                if (hashedPassword) {
                    await connection.promise().query(`
                    UPDATE users 
                    SET password = ?
                    WHERE token = UUID_TO_BIN(?)
                `, [hashedPassword, token]);
                    success = true;
                }


                connection.promise().end();

                return {
                    success: success
                };
            } catch (err) {
                console.error(err);
                return {
                    success: false,
                    message: "Error updating password"
                };
            }
        }, getFinishedLessonsByUserInGroup: async (group: string, token: string) => {
            const auth = await authUser(token);
            if (!auth.success) {
                return {
                    success: false,
                    message: "Authentication failed",
                };
            }

            const user = auth.user;
            const user_id = user.id;

            // Perform a SELECT query to fetch finished lessons by user in a group
            const [finishedLessons] = await connection.promise().query(`
        SELECT * FROM lpu
        WHERE user_id = ? 
        AND \`group\` = ?
    `, [user_id, group]);

            // @ts-ignore
            if (!finishedLessons) {
                return {
                    success: true,
                    finishedLessons: [],
                    ratio: 0,
                };
            }

            // @ts-ignore
            const totalFinished = finishedLessons.length;
            const [totalInGroupRows, _] = await connection.promise().query(`
        SELECT COUNT(*) AS totalInGroup FROM lessons
        WHERE \`group\` = ?
    `, [group]);

            connection.promise().end();

            const totalInGroup = totalInGroupRows[0]?.totalInGroup || 0;
            const ratio = totalInGroup !== 0 ? totalFinished / totalInGroup : 0;

            return {
                success: true,
                lessons: finishedLessons,
                ratio: ratio,
                count: totalFinished,
                groupTotal: totalInGroup
            };
        }
    }

    return self;
}

function responseJSON(success: boolean, dataFactory?: () => object, message?: string): any {
    return Object.assign({
        success: success,
        message: !success ? message : undefined
    }, success ? dataFactory() : undefined);
}