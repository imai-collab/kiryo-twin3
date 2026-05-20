import { Shogi } from 'shogi.js';

const shogi = new (Shogi as any)();
const sfen = '7kl/6g2/8R/5+b1N1/9/9/9/9/9 b Grb2g4s3n3l18p 1';
shogi.initializeFromSFENString(sfen);

console.log("Move N from 2,4 to 1,2 Promote...");
try {
  shogi.move(2, 4, 1, 2, true);
  console.log("Move done. Board 1,2:", shogi.get(1, 2));
  console.log("Is check (White)?", shogi.isCheck(1));
} catch(e) {
  console.error("Error:", e);
}

const shogi2 = new (Shogi as any)();
shogi2.initializeFromSFENString(sfen);
console.log("\nMove N from 2,4 to 3,2 Promote...");
try {
  shogi2.move(2, 4, 3, 2, true);
  console.log("Move done. Board 3,2:", shogi2.get(3, 2));
  console.log("Is check (White)?", shogi2.isCheck(1));
} catch(e) {
  console.error("Error:", e);
}
