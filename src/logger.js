const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf, colorize } = format;

module.exports = function (conf) {
  const { filename, loglabel } = conf;
  const options = { timestamp: true, colorize: true };
  const console = new transports.Console(options);
  let transportList = [console];
  if (filename) {
    const file = new transports.File({ filename });
    transports.push(file);
  }
  const myFormat = printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${label}] ${level}: ${message}`;
  });

  const logger = createLogger({
    format: combine(
      colorize({ all: true }),
      label({ label: loglabel }),
      timestamp(),
      myFormat
    ),
    transports: transportList,
  });

  if (process.env.NODE_ENV == 'development') {
    logger.level = 'debug';
  }
  return logger;
};
