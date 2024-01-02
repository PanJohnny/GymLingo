export const response = {
    badRequest: r(400),
    methodNotAllowed: r(405),
    ok: r(200),
    created: r(201),
    unauthorized: r(401),
    generic: (response: any, errCode: number) => {
        return new Response(JSON.stringify(response), {
            status: response.success ? 200 : errCode,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            }
        })
    },
    err: (err:any) => {
        return new Response(JSON.stringify({
            success: false,
            reason: "Uncaught exception",
            message: err
        }), {
            status: 500,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            }
        })
    }
}

function r(code: number) {
    return new Response(undefined, { status: code })
}