const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('C:/Users/seraj/.gemini/antigravity-ide/scratch/nZm-lshrf33/artifacts/construction-supervision/src');
let changedFiles = 0;

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let newContent = content;

  const badgeRegex = /<Badge\s+([^>]*?)className=(["'])([^"']*)bg-(green|emerald|amber|orange|red|blue|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-([456789]00)([^"']*)(["'])([^>]*)>/g;
  
  newContent = newContent.replace(badgeRegex, (match, beforeClass, q1, classBeforeBg, color, shade, classAfterBg, q2, afterClass) => {
    const fullClass = classBeforeBg + 'bg-' + color + '-' + shade + classAfterBg;
    if (fullClass.includes('text-')) {
      return match;
    } else {
      const newClass = fullClass + ' text-white';
      return '<Badge ' + beforeClass + 'className=' + q1 + newClass + q2 + afterClass + '>';
    }
  });

  // Also replace <Badge className="bg-primary"> with <Badge className="bg-primary text-white">
  const primaryRegex = /<Badge\s+([^>]*?)className=(["'])([^"']*)bg-primary([^"']*)(["'])([^>]*)>/g;
  newContent = newContent.replace(primaryRegex, (match, beforeClass, q1, classBeforeBg, classAfterBg, q2, afterClass) => {
    const fullClass = classBeforeBg + 'bg-primary' + classAfterBg;
    if (fullClass.includes('text-')) {
      return match;
    } else {
      const newClass = fullClass + ' text-white';
      return '<Badge ' + beforeClass + 'className=' + q1 + newClass + q2 + afterClass + '>';
    }
  });

  if (newContent !== content) {
    fs.writeFileSync(file, newContent);
    console.log('Fixed', file);
    changedFiles++;
  }
});

console.log('Done. Changed files:', changedFiles);
