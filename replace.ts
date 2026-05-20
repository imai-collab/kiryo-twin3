import fs from 'fs';
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(/const INITIAL_PROBLEMS: Problem\[\] = \[\s*\{[\s\S]*?\}\s*\];/, 'const INITIAL_PROBLEMS: Problem[] = problemsData as Problem[];');
fs.writeFileSync('src/App.tsx', content);
