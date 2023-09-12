import * as mysql from "mysql2";

export async function createAccount(username:string, password:string) {
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

export function createLesson(type:number, czech:string, polish:string, explanation:string, group:string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        connection.query(`INSERT INTO lessons (type, czech, polish, explanation, \`group\`) VALUES (?, ?, ?, ?, ?)`, [type, czech, polish, explanation, group]);
        connection.end();
    } catch(err) {
        connection.end();
        return false;
    }
    return true;
}

export async function getLessons() {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el =  (await connection.promise().query(`SELECT * FROM lessons`)).at(0);
        connection.end();
        return el;
    } catch(err) {
        connection.end();
        return false;
    }
}

export async function getLessonsByGroup(group:string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el =  (await connection.promise().query(`SELECT * FROM lessons WHERE \`group\` = ?`, [group])).at(0);
        connection.end();
        return el;
    } catch(err) {
        connection.end();
        return err;
    }
}

export async function login(username:string, password:string) {
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

export async function setAvatar(token:string, avatar:string) {
   return setString(token, "avatar_url", avatar);
}

export async function setUsername(token:string, username:string) {
    return setString(token, "username", username);
}

export async function setPassword(token:string, password:string) {
    return setString(token, "password", password)
}

export async function isAdmin(token:string) {
    // @ts-ignore
    return (await get(token, "admin")).at(0).at(0).admin;
}

async function get(token:string, key:string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        const el = await connection.promise().query(`SELECT ${key} FROM users WHERE token = UUID_TO_BIN(?)`, token);
        connection.end();
        return el;
    } catch (err) {
        console.error(err);
        connection.end();
        return false;
    }
}

async function setString(token:string, key:string, value:string) {
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL);
    try {
        await connection.promise().query(`UPDATE users SET ${key} = '${value}' WHERE token = UUID_TO_BIN(?)`, token);
        connection.end();
        return true;
    } catch (err) {
        console.error(err);
        connection.end();
        return false;
    }
}