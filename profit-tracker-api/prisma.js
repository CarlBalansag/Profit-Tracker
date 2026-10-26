const { PrismaClient } = require('@prisma/client');

// Single shared instance — never create PrismaClient anywhere else
const prisma = new PrismaClient();

module.exports = prisma;
