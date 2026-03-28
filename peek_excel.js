const XLSX = require('xlsx');
const path = require('path');

const filename = 'customerCorporate-28-03-26.12-39_bdc680.xlsx';
const workbook = XLSX.readFile(path.resolve(process.cwd(), filename));
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log('Headers:', data[0]);
console.log('Row 1:', data[1]);
console.log('Row 2:', data[2]);
