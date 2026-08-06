exports.handler = async (event, context) => {
  try {
    require('./process-worker-background.js');
    return { statusCode: 200, body: 'Required successfully' };
  } catch (e) {
    return { statusCode: 200, body: 'Error: ' + JSON.stringify(e, Object.getOwnPropertyNames(e)) };
  }
};
