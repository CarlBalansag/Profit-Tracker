// A 5 MiB file expands to about 6.67 MiB in base64 plus JSON metadata.
module.exports = require('express').json({ limit: '7mb' });
