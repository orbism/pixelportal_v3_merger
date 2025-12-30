const fs = require('fs');

const srcFile = '../hardhat/abi.json';
const dstFile = './src/contracts/abi.json';
const srcFileExists = fs.existsSync(srcFile);
const dstFileExists = fs.existsSync(dstFile);

if (srcFileExists) {
  if (!dstFileExists) {
    console.log('📂 creating ./src/contracts directory');
    fs.mkdirSync('./src/contracts', { recursive: true });
  }

  try {
    fs.copyFile(srcFile, dstFile, (err) => {
      if (err) {
        console.log('error hit copying file');
        throw err;
      }
    });
    console.log('✅ src/contracts/abi.json created');
  } catch (error) {
    console.log(error);
  }
} else {
  console.log('⚠️ could not find hardhat contracts');
}
