const fs=require('fs'),path=require('path'),base=__dirname;
const modules=['minimal-kit','compact-core-acts','compact-prop-acts','compact-state-acts'].filter(n=>fs.existsSync(path.join(base,'modules',n+'.js'))).map(n=>fs.readFileSync(path.join(base,'modules',n+'.js'),'utf8')).join('\n');
const source=fs.readFileSync(path.join(base,'shell.html'),'utf8').replace('/* INLINE_MODULES */',modules).replace('/* INLINE_PLAYER */',fs.readFileSync(path.join(base,'player.js'),'utf8'));
fs.writeFileSync(path.join(base,'study.html'),source);console.log('Built '+source.length+' bytes');
