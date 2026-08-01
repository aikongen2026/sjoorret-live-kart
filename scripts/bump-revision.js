const fs=require('fs');
const path=require('path');

function nextRevision(value) {
  const match=String(value).match(/\d+/);
  const current=match?Number(match[0]):Number(value);
  if(!Number.isInteger(current)||current<0) throw new Error(`Ugyldig revisjon: ${value}`);
  return current+1;
}
function formatRevision(value) {
  const number=Number(value);
  if(!Number.isInteger(number)||number<0) throw new Error(`Ugyldig revisjon: ${value}`);
  return `REV ${String(number).padStart(2,'0')}`;
}
function replaceRevision(file,revision) {
  const before=fs.readFileSync(file,'utf8');
  const isHtml=path.basename(file)==='index.html';
  const pattern=isHtml?/(id="revisionBadge">)REV \d{2}/:/^(# Fiste guiden – )REV \d{2}/m;
  if(!pattern.test(before)) throw new Error(`Fant ingen synlig revisjonsmarkør i ${file}`);
  const after=before.replace(pattern,`$1${revision}`);
  fs.writeFileSync(file,after);
}
function bump(root=path.resolve(__dirname,'..')) {
  const packagePath=path.join(root,'package.json');
  const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
  const number=nextRevision(pkg.appRevision);
  const revision=formatRevision(number);
  pkg.appRevision=number;
  fs.writeFileSync(packagePath,`${JSON.stringify(pkg,null,2)}\n`);
  replaceRevision(path.join(root,'public','index.html'),revision);
  replaceRevision(path.join(root,'README.md'),revision);
  return {number,revision};
}
if(require.main===module) {
  const result=bump();
  process.stdout.write(`${result.revision}\n`);
}
module.exports={nextRevision,formatRevision,bump};
