const { server } = require('./server.js');

server.listen(Number(process.env.PORT) || 3000);
