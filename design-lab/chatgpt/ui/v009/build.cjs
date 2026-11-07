const fs=require('fs'),path=require('path');
const dir=__dirname;
const source=fs.readFileSync(path.join(dir,'shell.html'),'utf8')+'<script>\n'+['minimal-kit.js','compact-core-acts.js','compact-state-acts.js'].map(file=>fs.readFileSync(path.join(dir,'sources',file),'utf8')).join('\n')+'\n'+fs.readFileSync(path.join(dir,'motion.js'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'app.js'),'utf8')+'\n</script>\n</div>\n';
fs.writeFileSync(path.join(dir,'study.html'),source);
