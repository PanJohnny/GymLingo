import * as mysql from "mysql2";

export async function createAccount(username: string, password: string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    // Check if username exists `
    const selected = connection.promise().query(`SELECT COUNT(1) FROM users WHERE username = ?`, [username]);
    //@ts-ignore
    if ((await selected).at(0).at(0)['count(1)'] == 0) {
        connection.query(`INSERT INTO users (username, password, token) VALUES (?, ?, UUID_TO_BIN(UUID()))`, [username, password]);
    } else {
        connection.end();
        return false;
    }

    connection.end();
    return true;
}

export function createLesson(type: number, czech: string, polish: string, explanation: string, group: string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        connection.query(`INSERT INTO lessons (type, czech, polish, explanation, \`group\`) VALUES (?, ?, ?, ?, ?)`, [type, czech, polish, explanation, group]);
        connection.end();
    } catch (err) {
        connection.end();
        return false;
    }
    return true;
}

export async function getLessons() {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el = (await connection.promise().query(`SELECT * FROM lessons`)).at(0);
        connection.end();
        return el;
    } catch (err) {
        connection.end();
        return false;
    }
}

export async function getLesson(id: number) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el = (await connection.promise().query(`SELECT * FROM lessons WHERE id = ${id}`)).at(0);
        connection.end();
        return el;
    } catch (err) {
        console.log(err);

        connection.end();
        return false;
    }
}

export async function getLessonsByGroup(group: string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el = (await connection.promise().query(`SELECT * FROM lessons WHERE \`group\` = ?`, [group])).at(0);
        connection.end();
        return el;
    } catch (err) {
        connection.end();
        return err;
    }
}

export async function login(username: string, password: string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    // Check if username exists `
    const selected = connection.promise().query(`SELECT username, password, icon_url FROM users WHERE username = ?`, [username]);
    let arr = (await selected).at(0);
    // @ts-ignore
    if (arr.length > 0 && arr[0].password == password) {
        const all = connection.promise().query(`SELECT username, icon_url, BIN_TO_UUID(token) token FROM users WHERE username = ?`, username);
        arr = (await all).at(0);
        connection.end();
        return arr[0];
    }
    connection.end();
    return false;
}

export async function getIcon(token: string) {
    try {
        // @ts-ignore
        return (await get(token, "icon_url")).at(0).at(0).icon_url;
    } catch (err) {
        return null;
    }
}

export async function setAvatar(token: string, avatar: string) {
    return setString(token, "icon_url", avatar);
}

export async function setUsername(token: string, username: string) {
    return setString(token, "username", username);
}

export async function setPassword(token: string, password: string) {
    return setString(token, "password", password)
}

export async function isAdmin(token: string) {
    try {
        // @ts-ignore
        return (await get(token, "admin")).at(0).at(0).admin;
    } catch (err) {
        return null;
    }
}

export async function getUser(token: string) {
    try {
        // @ts-ignore
        return (await get(token, "username, icon_url, admin")).at(0).at(0);
    } catch (err) {
        return null;
    }
}

async function get(token: string, key: string) {
    if (!token)
        return false;
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el = await connection.promise().query(`SELECT ${key} FROM users WHERE token = UUID_TO_BIN(?)`, token);
        connection.end();
        return el;
    } catch (err) {
        connection.end();
        return false;
    }
}

async function setString(token: string, key: string, value: string) {
    if (!token)
        return false;
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        await connection.promise().query(`UPDATE users SET ${key} = ? WHERE token = UUID_TO_BIN(?)`, [value, token]);
        connection.end();
        return true;
    } catch (err) {
        connection.end();
        console.log(err);
        return false;
    }
}

export async function verifyLesson(token: string, group: string, lesson_id: number, polish: string) {
    const user_id = (await get(token, "id")).at(0).at(0).id;
    if (lesson_id == null || !user_id)
        return {
            success: false,
            code: 400
        };

    const la = await getLesson(lesson_id);

    if (!la || la.length != 1)
        return {
            success: false,
            code: 404
        };

    const lesson = la.at(0);

    if (lesson.polish.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() !=
        polish.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase())
        return {
            success: false,
            code: 409
        };

    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);

    try {
        await connection.promise().query(`
    INSERT INTO lpu (\`user_id\`, \`lesson_id\`, \`group\`)
    SELECT ${user_id}, ${lesson_id}, "${group}"
    WHERE NOT EXISTS (
        SELECT \`user_id\` FROM lpu
        WHERE \`user_id\` = ${user_id}
        AND \`group\` = "${group}"
        AND \`lesson_id\` = ${lesson_id}
    )
`);
        connection.end();
        return {
            success: true,
            lesson: lesson,
            code: 200
        };
    } catch (err) {
        connection.end();
        return {
            success: false
        };
    }
}

export async function groupFinished(group: string, token: string) {
    const resp = await get(token, "id");
    if (!resp)
        return false;

    const user_id = resp.at(0).at(0).id;

    if (!user_id)
        return false;

    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);

    try {
        const el = await connection.promise().query(`
        SELECT
    (SELECT COUNT(*) FROM lpu WHERE user_id = ${user_id} AND \`group\` = "${group}") AS finished,
    (SELECT COUNT(*) FROM lessons WHERE \`group\` = "${group}") AS lessons,
    (
        SELECT COUNT(*) FROM lpu WHERE user_id = ${user_id} AND \`group\` = "${group}"
    ) / (
        SELECT COUNT(*) FROM lessons WHERE \`group\` = "${group}"
    ) AS ratio;
        `);

        connection.end();
        return el.at(0).at(0);
    } catch (err) {
        connection.end();
        return false;
    }
}

export async function isValidToken(token: string) {
    try {
        if ((await getUser(token)).username)
            return true;
        else
            return false;
    } catch (err) {
        return false;
    }
}