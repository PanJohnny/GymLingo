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
    const connection = mysql.createConnection(import.meta.env.DATABASE_URL).promise();

    const authUser = async (token: string) => {
        const userQuery = (await connection.query(`SELECT username, token_created_at, admin, id FROM users WHERE token = UUID_TO_BIN(?)`, [token]).catch(err => {
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
            const userQuery = (await connection.query(`SELECT username, password, icon_url, id FROM users WHERE username = ?`, [username]))[0][0];
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

            await connection.query(
                `UPDATE users SET token = UUID_TO_BIN(?), token_created_at = NOW() WHERE id = ?`,
                [token, userId]
            );



            return {
                username: userQuery.username,
                avatar: userQuery.icon_url,
                token: token,
                success: true
            }
        },
        register: async (username: string, password: string) => {
            // Check if username exists
            const exists = (await connection.query(`SELECT COUNT(1) FROM users WHERE username = ?`, [username]))[0][0]["count(1)"];
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
                await connection.query(`INSERT INTO users (username, password, token) VALUES (?, ?, UUID_TO_BIN(?))`, [username, hashedPassword, token]);
            }



            return responseJSON(hashedPassword != null, () => {
                return {
                    token: token,
                }
            }, "Interní chyba");
        },
        createLesson: async (type: number, czech: string, polish: string, explanation: string, group: string) => {
            try {
                await connection.query(`INSERT INTO lessons (type, czech, polish, explanation, \`group\`) VALUES (?, ?, ?, ?, ?)`, [type, czech, polish, explanation, group]);

                return {
                    success: true
                }
            } catch (err) {
                return {
                    success: false,
                    message: "Chyba při vytváření lekce"
                };
            }
        },
        getLessons: async (selector: string) => {
            // parse selector
            // * / group #id
            let lessons: any;
            if (selector.includes("*"))
                lessons = await connection.query("SELECT * FROM lessons");
            else if (selector.startsWith("#")) {
                lessons = await connection.query("SELECT * FROM lessons WHERE \`id\` = ?", [selector.substring(1)]);
            } else
                lessons = await connection.query(`SELECT * FROM lessons WHERE \`group\` = ?`, [selector]);

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
            const lessons = await self.getLessons("#" + lesson_id);


            if (!lessons.success || !lessons.lessons[0]) {
                return {
                    success: false,
                    message: "Lekce nenalezena"
                };
            }

            const lesson = lessons.lessons[0];

            if (lesson.polish.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[\?\!]/gm, "").toLowerCase() !=
                polish.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[\?\!]/gm, "").toLowerCase()) {
                return {
                    success: false,
                    message: "Špatná odpověď",
                };
            }

            connection.query(`
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

                });

            return {
                success: true,
                lesson: lesson,
            };
        },
        getUser: async (token) => {
            try {
                const [rows] = await connection.query(`
                    SELECT id, username, icon_url, admin 
                    FROM users 
                    WHERE token = UUID_TO_BIN(?)
                `, [token]);



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
                        message: "Uživatel nebyl nalezen"
                    };
                }
            } catch (err) {
                console.error("Error getting user:", err);
                return {
                    success: false,
                    message: "Chyba při získávání uživatelských informací"
                };
            }
        },
        getAvatarByUsername: async (username) => {
            try {
                const [rows] = await connection.query(`
                    SELECT icon_url 
                    FROM users 
                    WHERE username = ?
                `, [username]);



                // @ts-ignore
                if (rows.length > 0) {
                    return {
                        success: true,
                        avatar: rows[0].icon_url
                    };
                } else {
                    return {
                        success: false,
                        message: "Uživatel nenalezen"
                    };
                }
            } catch (err) {
                console.error("Error getting avatar:", err);
                return {
                    success: false,
                    message: "Chyba při získávání avatara"
                };
            }
        },
        updateUsernameByToken: async (token, newUsername) => {
            try {
                await connection.query(`
                    UPDATE users 
                    SET username = ?
                    WHERE token = UUID_TO_BIN(?)
                `, [newUsername, token]);



                return {
                    success: true
                };
            } catch (err) {
                console.error(err);
                return {
                    success: false,
                    message: "Chyba při měnění uživatelského jména"
                };
            }
        },
        updateAvatarByToken: async (token, newURL) => {
            try {
                await connection.query(`
                    UPDATE users 
                    SET icon_url = ?
                    WHERE token = UUID_TO_BIN(?)
                `, [newURL, token]);



                return {
                    success: true
                };
            } catch (err) {
                console.error(err);
                return {
                    success: false,
                    message: "Chyba při aktualizaci avatara"
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
                    await connection.query(`
                    UPDATE users 
                    SET password = ?
                    WHERE token = UUID_TO_BIN(?)
                `, [hashedPassword, token]);
                    success = true;
                }




                return {
                    success: success
                };
            } catch (err) {
                console.error(err);
                return {
                    success: false,
                    message: "Chyba při změně hesla"
                };
            }
        }, getFinishedLessonsByUserInGroup: async (group: string, token: string) => {
            const auth = await authUser(token);
            if (!auth.success) {
                return {
                    success: false,
                    message: "Přístup zamítnut",
                };
            }

            const user = auth.user;
            const user_id = user.id;

            // Perform a SELECT query to fetch finished lessons by user in a group
            const [finishedLessons] = await connection.query(`
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
            const [totalInGroupRows, _] = await connection.query(`
        SELECT COUNT(*) AS totalInGroup FROM lessons
        WHERE \`group\` = ?
    `, [group]);



            const totalInGroup = totalInGroupRows[0]?.totalInGroup || 0;
            const ratio = totalInGroup !== 0 ? totalFinished / totalInGroup : 0;

            return {
                success: true,
                lessons: finishedLessons,
                ratio: ratio,
                count: totalFinished,
                groupTotal: totalInGroup
            };
        }, removeAllUserData: async (username, password) => {
            try {
                // Fetch user by username
                const [userData, _] = await connection.query(
                    'SELECT * FROM users WHERE username = ? LIMIT 1',
                    [username]
                );

                // @ts-ignore
                if (!userData || userData.length === 0) {
                    return {
                        success: false,
                        message: "Uživatel nenalezen",
                    };
                }

                const user = userData[0];

                // Verify password
                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    return {
                        success: false,
                        message: "Špatné heslo",
                    };
                }

                // Begin transaction for safe delete operations
                await connection.beginTransaction();

                // Delete user data from lpu table
                await connection.query(
                    'DELETE FROM lpu WHERE user_id = ?',
                    [user.id]
                );

                // Delete user from users table
                await connection.query(
                    'DELETE FROM users WHERE id = ?',
                    [user.id]
                );

                // Commit the transaction if successful
                await connection.commit();

                return {
                    success: true,
                    message: "Uživatel byl úspěšně vymazán",
                };
            } catch (error) {
                // Rollback the transaction in case of any errors
                await connection.rollback();

                // Log the error for debugging
                console.error("Error removing user data:", error);

                // Return error message for user
                return {
                    success: false,
                    message: "Něco se pokazilo při vymazávání vašeho účtu, prosím kontaktujte administrátora stránky janstefanca@seznam.cz",
                };
            }
        }, auth: async (token: string) => {
            const auth = await authUser(token);

            return auth;
        }, end: async () => {
            try {
                connection.end();
            } catch (err) {
                console.error(err);
            }
        }, removeLessonById: async (lessonId) => {
            try {
                // Begin transaction for safe delete operations
                await connection.beginTransaction();

                // Delete records from lpu table associated with the lesson
                await connection.query(
                    'DELETE FROM lpu WHERE lesson_id = ?',
                    [lessonId]
                );

                // Delete lesson from lessons table
                await connection.query(
                    'DELETE FROM lessons WHERE id = ?',
                    [lessonId]
                );

                // Commit the transaction if successful
                await connection.commit();

                return {
                    success: true,
                    message: "Lekce a záznamy vymazány",
                };
            } catch (error) {
                // Rollback the transaction in case of any errors
                await connection.rollback();

                // Log the error for debugging
                console.error("Error removing lesson and associated records:", error);

                // Return error message
                return {
                    success: false,
                    message: "Chyba při mazání: " + error,
                };
            }
        }, updateLessonById: async (lessonId, czech, polish, explanation, type, group) => {
            try {
                const updateFields = [];
                const updateValues = [];

                if (czech !== undefined && czech !== null) {
                    updateFields.push('czech = ?');
                    updateValues.push(czech);
                }

                if (group !== undefined && group !== null) {
                    updateFields.push('\`group\` = ?');
                    updateValues.push(group);
                }

                if (polish !== undefined && polish !== null) {
                    updateFields.push('polish = ?');
                    updateValues.push(polish);
                }

                if (explanation !== undefined && explanation !== null) {
                    updateFields.push('explanation = ?');
                    updateValues.push(explanation);
                }

                if (type !== undefined && type !== null) {
                    updateFields.push('type = ?');
                    updateValues.push(type);
                }

                if (updateFields.length === 0) {
                    return {
                        success: false,
                        message: "Žádná pole k aktualizaci",
                    };
                }

                updateValues.push(lessonId); // Push lessonId as the last value for WHERE clause

                // Construct the SET part of the SQL query based on the provided fields
                const setClause = updateFields.join(', ');

                // Begin transaction for safe update operation
                await connection.beginTransaction();

                const updateQuery = `UPDATE lessons SET ${setClause} WHERE id = ?`;

                // Update the lesson in the lessons table
                await connection.query(
                    updateQuery,
                    updateValues
                );

                // Commit the transaction if successful
                await connection.commit();

                return {
                    success: true,
                    message: "Lekce byla úspěšně aktualizována",
                };
            } catch (error) {
                // Rollback the transaction in case of any errors
                await connection.rollback();

                // Log the error for debugging
                console.error("Chyba při aktualizaci lekce:", error);

                // Return error message
                return {
                    success: false,
                    message: "Při aktualizaci lekce došlo k chybě",
                };
            }
        }, getUsers: async () => {
            try {
                const [rows] = await connection.query(`
                    SELECT id, username, icon_url, admin 
                    FROM users
                `);

                // @ts-ignore
                if (rows.length > 0) {
                    return {
                        success: true,
                        users: rows
                    };
                } else {
                    return {
                        success: false,
                        message: "Uživatel nebyl nalezen"
                    };
                }
            } catch (err) {
                console.error("Error getting user:", err);
                return {
                    success: false,
                    message: "Chyba při získávání uživatelských informací"
                };
            }
        }, removeUserById: async (userId) => {
            try {
                // Begin transaction for safe delete operations
                await connection.beginTransaction();

                // Delete records from lpu table associated with the lesson
                await connection.query(
                    'DELETE FROM lpu WHERE user_id = ?',
                    [userId]
                );

                // Delete lesson from lessons table
                await connection.query(
                    'DELETE FROM users WHERE id = ?',
                    [userId]
                );

                // Commit the transaction if successful
                await connection.commit();

                return {
                    success: true,
                    message: "Uživatel a záznamy vymazány",
                };
            } catch (error) {
                // Rollback the transaction in case of any errors
                await connection.rollback();

                // Log the error for debugging
                console.error("Error removing user and associated records:", error);

                // Return error message
                return {
                    success: false,
                    message: "Chyba při mazání: " + error,
                };
            }
        }, getUserById: async (id) => {
            try {
                const [rows] = await connection.query(`
                    SELECT id, username, icon_url, admin 
                    FROM users 
                    WHERE id = ?
                `, [id]);



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
                        message: "Uživatel nebyl nalezen"
                    };
                }
            } catch (err) {
                console.error("Error getting user:", err);
                return {
                    success: false,
                    message: "Chyba při získávání uživatelských informací"
                };
            }
        }, getUserByName: async (username) => {
            try {
                const [rows] = await connection.query(`
                    SELECT id, username, icon_url, admin 
                    FROM users 
                    WHERE username = ?
                `, [username]);



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
                        message: "Uživatel nebyl nalezen"
                    };
                }
            } catch (err) {
                console.error("Error getting user:", err);
                return {
                    success: false,
                    message: "Chyba při získávání uživatelských informací"
                };
            }
        }, updateUserById: async (userId, username, icon_url, admin) => {
            try {
                const updateFields = [];
                const updateValues = [];

                if (username !== undefined && username !== null) {
                    updateFields.push('username = ?');
                    updateValues.push(username);
                }

                if (icon_url !== undefined && icon_url !== null) {
                    updateFields.push('icon_url = ?');
                    updateValues.push(icon_url);
                }

                if (admin !== undefined && admin !== null) {
                    updateFields.push('admin = ?');
                    updateValues.push(admin);
                }

                if (updateFields.length === 0) {
                    return {
                        success: false,
                        message: "Žádná pole k aktualizaci",
                    };
                }

                updateValues.push(userId); // Push userId as the last value for WHERE clause

                // Construct the SET part of the SQL query based on the provided fields
                const setClause = updateFields.join(', ');

                // Begin transaction for safe update operation
                await connection.beginTransaction();

                const updateQuery = `UPDATE users SET ${setClause} WHERE id = ?`;

                // Update the lesson in the lessons table
                await connection.query(
                    updateQuery,
                    updateValues
                );

                // Commit the transaction if successful
                await connection.commit();

                return {
                    success: true,
                    message: "Uživatel byl úspěšně aktualizován",
                };
            } catch (error) {
                // Rollback the transaction in case of any errors
                await connection.rollback();

                // Log the error for debugging
                console.error("Chyba při aktualizaci uživatele:", error);

                // Return error message
                return {
                    success: false,
                    message: "Chyba při aktualizaci uživatele: " + error,
                };
            }
        }, getFinishedLessonsByUser: async (id: string) => {

            // Perform a SELECT query to fetch finished lessons by user in a group
            const [finishedLessons] = await connection.query(`
            SELECT *
            FROM lpu
            WHERE user_id = ?        
    `, [id]);

            // @ts-ignore
            if (!finishedLessons) {
                return {
                    success: true,
                    finishedLessons: [],
                    count: 0,
                };
            }

            // @ts-ignore
            const totalFinished = finishedLessons.length;
            const [occurance, _] = await connection.query(`
            SELECT \`group\`, COUNT(*) as occurrence_count
            FROM lessons
            GROUP BY \`group\`;
            
    `);

            const [useOccurance, __] = await connection.query(`
            SELECT \`group\`, COUNT(*) as occurrence_count
FROM lpu
WHERE user_id = ?
GROUP BY \`group\`;

            `, [id]);


            return {
                success: true,
                lessons: finishedLessons,
                count: totalFinished,
                groupTotals: occurance,
                userTotals: useOccurance
            };
        }
    }

    return self;
}

export async function isValidUser(token: string) {
    const { auth, end } = connect();
    const res = (await auth(token)).success;
    end();
    return res;
}

function responseJSON(success: boolean, dataFactory?: () => object, message?: string): any {
    return Object.assign({
        success: success,
        message: !success ? message : undefined
    }, success ? dataFactory() : undefined);
}