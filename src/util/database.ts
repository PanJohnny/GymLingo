import * as mysql from "mysql2";
import bcrypt from "bcryptjs";

async function hash(val: string) {
    return await bcrypt.hash(val, 10);
}

async function compare(val1: string, val2: string) {
    return await bcrypt.compare(val1, val2);
}

const tokenValidityPeriod = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

export const connect = () => {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);

    const authUser = async (token: string) => {
        const userQuery = (await connection.promise().query(`SELECT username, token_created_at, admin, id FROM users WHERE token = UUID_TO_BIN(?)`, [token]))[0][0];
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
            const userQuery = (await connection.promise().query(`SELECT username, password, icon_url FROM users WHERE username = ?`, [username]))[0][0];
            if (!userQuery || !userQuery.username || !userQuery.password) {
                return {
                    success: false,
                    message: "Uživatel s tímto uživatelským jménem neexistuje"
                }
            }

            const token = crypto.randomUUID();

            // Regenerate UUID
            await connection.promise().query(`INSERT INTO users (username, password, token, token_created_at) VALUES (?, ?, UUID_TO_BIN(?), NOW())`, [username, password, token]);

            connection.promise().end();

            return responseJSON(userQuery && await compare(password, userQuery.password), () => {
                return {
                    username: userQuery.username,
                    avatar: userQuery.icon_url,
                    token: token
                }
            }, "Špatné heslo");
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

            const response = await connection.promise().query(`INSERT INTO users (username, password, token) VALUES (?, ?, UUID_TO_BIN(UUID()))`, [username, await hash(password)]);

            connection.promise().end();

            return {
                success: true
            };
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
        verifyLesson: async (token: string, group: string, lesson_id: number, polish: string) => {
            const auth = await authUser(token);
            if (!auth.success)
                return auth;

            const user = auth.user;
            const lessons = await self.getLessons("#" + lesson_id, true);

            console.log(lessons);
            

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
    SELECT ?, ?, "?"
    WHERE NOT EXISTS (
        SELECT \`user_id\` FROM lpu
        WHERE \`user_id\` = ?
        AND \`group\` = "?"
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