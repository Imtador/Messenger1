const argon2 = require('argon2');

const config = {
  memoryCost: parseInt(process.env.ARGON2_MEMORY_COST) || 65536,
  timeCost: parseInt(process.env.ARGON2_TIME_COST) || 3,
  parallelism: parseInt(process.env.ARGON2_PARALLELISM) || 4,
};

async function hashPassword(password) {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    ...config,
  });
}

async function verifyPassword(hash, password) {
  return await argon2.verify(hash, password);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
