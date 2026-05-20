const { Shogi, Color } = require('shogi.js');

function getLegalMoves(shogi, color) {
  const moves = [];
  const board = shogi.board;
  
  // Generate drops
  const hand = shogi.hands[color];
  for (const piece in hand) {
    if (hand[piece] > 0) {
      for (let x = 1; x <= 9; x++) {
        for (let y = 1; y <= 9; y++) {
          if (!board[x - 1][y - 1]) {
            // Check if drop is legal (e.g. no double pawn, no pawn on last rank)
            if (piece === 'FU') {
              if (color === Color.Black && y === 1) continue;
              if (color === Color.White && y === 9) continue;
              // Double pawn check
              let hasPawn = false;
              for (let i = 1; i <= 9; i++) {
                const p = board[x - 1][i - 1];
                if (p && p.color === color && p.kind === 'FU') {
                  hasPawn = true;
                  break;
                }
              }
              if (hasPawn) continue;
            }
            if (piece === 'KY' && ((color === Color.Black && y === 1) || (color === Color.White && y === 9))) continue;
            if (piece === 'KE' && ((color === Color.Black && y <= 2) || (color === Color.White && y >= 8))) continue;
            
            moves.push({ to: { x, y }, piece });
          }
        }
      }
    }
  }
  
  // Generate moves
  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const piece = board[x - 1][y - 1];
      if (piece && piece.color === color) {
        const pieceMoves = shogi.getMovesFrom(x, y);
        for (const move of pieceMoves) {
          moves.push({ from: { x, y }, to: { x: move.to.x, y: move.to.y }, promote: false });
          
          // Check promotion
          const isPromotionZone = color === Color.Black ? (y <= 3 || move.to.y <= 3) : (y >= 7 || move.to.y >= 7);
          const isPromoted = ["TO", "NY", "NK", "NG", "UM", "RY"].includes(piece.kind);
          const canPromote = !isPromoted && !['KI', 'OU', 'GY'].includes(piece.kind) && isPromotionZone;
          
          if (canPromote) {
            moves.push({ from: { x, y }, to: { x: move.to.x, y: move.to.y }, promote: true });
          }
        }
      }
    }
  }
  
  return moves;
}

function applyMoveToShogi(shogi, move) {
  if (move.from) {
    shogi.move(move.from.x, move.from.y, move.to.x, move.to.y, move.promote);
  } else if (move.piece) {
    shogi.drop(move.to.x, move.to.y, move.piece);
  }
}

function formatMove(move) {
  if (move.piece) {
    return `${move.to.x}${move.to.y}${move.piece}打`;
  } else {
    return `${move.from.x}${move.from.y} -> ${move.to.x}${move.to.y}${move.promote ? '成' : ''}`;
  }
}

function solve(sfen, maxDepth) {
  const shogi = new Shogi();
  shogi.initializeFromSFENString(sfen);
  
  function search(d, isBlack) {
    if (d === 0) return false;
    
    const color = isBlack ? Color.Black : Color.White;
    let legalMoves = getLegalMoves(shogi, color);
    
    if (isBlack) {
      legalMoves = legalMoves.filter(m => {
        const s = shogi.toSFENString(1);
        applyMoveToShogi(shogi, m);
        const isCheck = shogi.isCheck(Color.White);
        shogi.initializeFromSFENString(s);
        return isCheck;
      });
      
      if (legalMoves.length === 0) return false;
      
      for (const move of legalMoves) {
        const s = shogi.toSFENString(1);
        applyMoveToShogi(shogi, move);
        const res = search(d - 1, false);
        shogi.initializeFromSFENString(s);
        if (res) return [move].concat(Array.isArray(res) ? res : []);
      }
      return false;
    } else {
      if (legalMoves.length === 0) return true;
      
      let longestPath = null;
      for (const move of legalMoves) {
        const s = shogi.toSFENString(1);
        applyMoveToShogi(shogi, move);
        const res = search(d - 1, true);
        shogi.initializeFromSFENString(s);
        if (!res) return false; // Found a refutation
        if (!longestPath || (Array.isArray(res) && res.length > longestPath.length)) {
           longestPath = [move].concat(Array.isArray(res) ? res : []);
        }
      }
      return longestPath || true; 
    }
  }
  
  for (let d = 1; d <= maxDepth; d += 2) {
      const res = search(d, true);
      if (res) return res;
  }
  return false;
}

console.log("Solving...");
const res = solve('9/7k1/6s2/5+P3/9/9/9/9/9 b G 1', 7); // Wait, SFEN is 9/7k1/6s2/5+P3/9/9/9/9/9 b G 1?
// No, 22 King, 32 Silver, 43 To.
// Row 1: 9
// Row 2: 6 s k 1 (6 empty, 1 silver, 1 king, 1 empty) -> 6sk1
// Row 3: 5 +P 3 (5 empty, 1 To, 3 empty) -> 5+P3
// So SFEN: 9/6sk1/5+P3/9/9/9/9/9/9 b G 1
const res2 = solve('9/6sk1/5+P3/9/9/9/9/9/9 b G 1', 7);
if (res2) {
    console.log("Result:");
    res2.forEach(m => console.log(formatMove(m)));
} else {
    console.log("No mate found.");
}
