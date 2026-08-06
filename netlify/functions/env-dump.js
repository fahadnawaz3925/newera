exports.handler = async (event, context) => { return { statusCode: 200, body: JSON.stringify(Object.keys(process.env).filter(k => !k.startsWith('npm_'))) }; };
