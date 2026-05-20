import * as ShogiModule from 'shogi.js';

const Shogi = (ShogiModule as any).Shogi || (ShogiModule as any).default?.Shogi || (ShogiModule as any).default;
const Color = (ShogiModule as any).Color || (ShogiModule as any).default?.Color || { Black: 0, White: 1 };

export interface Position {
  x: number;
  y: number;
}

export interface Move {
  from?: Position;
  to: Position;
  piece?: string;
  promote?: boolean;
}

export function solveTsumeShogi(sfen: string, maxDepth: number): Move[] | null {
    const shogi = new Shogi();
    try {
        if (shogi.initializeFromSFENString) {
            shogi.initializeFromSFENString(sfen);
        } else {
            shogi.initializeFromSFEN(sfen);
        }
    } catch (e) {
        console.error("Invalid SFEN:", sfen);
        return null;
    }

    function search(depth: number, isBlackTurn: boolean): any {
        if (depth === 0) {
            // Check if it's checkmate
            const checkColor = isBlackTurn ? Color.White : Color.Black;
            const checkMoves = [];
            for (let x = 1; x <= 9; x++) {
                for (let y = 1; y <= 9; y++) {
                    const p = shogi.board[x - 1][y - 1];
                    if (p && p.color === checkColor) {
                        checkMoves.push(...shogi.getMovesFrom(x, y));
                    }
                }
            }
            const checkDrops = shogi.getDropsBy(checkColor);
            for (const d of checkDrops) {
                for (let x = 1; x <= 9; x++) {
                    for (let y = 1; y <= 9; y++) {
                        if (!shogi.board[x - 1][y - 1]) {
                            checkMoves.push({ to: { x, y }, piece: d.kind, color: checkColor });
                        }
                    }
                }
            }
            const checkLegalMoves = checkMoves.filter((wm: any) => {
                const ws = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                try {
                    if (wm.from) shogi.move(wm.from.x, wm.from.y, wm.to.x, wm.to.y, wm.promote);
                    else shogi.drop(wm.to.x, wm.to.y, wm.piece);
                    const isLegal = !shogi.isCheck(checkColor);
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                    else shogi.initializeFromSFEN(ws);
                    return isLegal;
                } catch (e) {
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                    else shogi.initializeFromSFEN(ws);
                    return false;
                }
            });
            return checkLegalMoves.length === 0 ? [] : null;
        }

        const color = isBlackTurn ? Color.Black : Color.White;
        const moves: any[] = [];
        for (let x = 1; x <= 9; x++) {
            for (let y = 1; y <= 9; y++) {
                const p = shogi.board[x - 1][y - 1];
                if (p && p.color === color) {
                    moves.push(...shogi.getMovesFrom(x, y));
                }
            }
        }
        const drops = shogi.getDropsBy(color);
        for (const d of drops) {
            for (let x = 1; x <= 9; x++) {
                for (let y = 1; y <= 9; y++) {
                    if (!shogi.board[x - 1][y - 1]) {
                        moves.push({ to: { x, y }, piece: d.kind, color: color });
                    }
                }
            }
        }

        const legalMoves = moves.filter(m => {
            const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
            try {
                if (m.from) {
                    shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                } else {
                    shogi.drop(m.to.x, m.to.y, m.piece);
                }
                const isLegal = !shogi.isCheck(color);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                return isLegal;
            } catch (e) {
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                return false;
            }
        });

        if (isBlackTurn) {
            const checkMoves = legalMoves.filter(m => {
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                else shogi.drop(m.to.x, m.to.y, m.piece);
                const isCheck = shogi.isCheck(Color.White);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                return isCheck;
            });

            for (const m of checkMoves) {
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                else shogi.drop(m.to.x, m.to.y, m.piece);
                
                // Check if it's checkmate by seeing if White has any legal moves
                const whiteMoves = [];
                for (let x = 1; x <= 9; x++) {
                    for (let y = 1; y <= 9; y++) {
                        const p = shogi.board[x - 1][y - 1];
                        if (p && p.color === Color.White) {
                            whiteMoves.push(...shogi.getMovesFrom(x, y));
                        }
                    }
                }
                const whiteDrops = shogi.getDropsBy(Color.White);
                for (const d of whiteDrops) {
                    for (let x = 1; x <= 9; x++) {
                        for (let y = 1; y <= 9; y++) {
                            if (!shogi.board[x - 1][y - 1]) {
                                whiteMoves.push({ to: { x, y }, piece: d.kind, color: Color.White });
                            }
                        }
                    }
                }
                const whiteLegalMoves = whiteMoves.filter((wm: any) => {
                    const ws = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                    try {
                        if (wm.from) shogi.move(wm.from.x, wm.from.y, wm.to.x, wm.to.y, wm.promote);
                        else shogi.drop(wm.to.x, wm.to.y, wm.piece);
                        const isLegal = !shogi.isCheck(Color.White);
                        if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                        else shogi.initializeFromSFEN(ws);
                        return isLegal;
                    } catch (e) {
                        if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                        else shogi.initializeFromSFEN(ws);
                        return false;
                    }
                });

                if (whiteLegalMoves.length === 0) {
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                    else shogi.initializeFromSFEN(s);
                    return [m];
                }

                const res = search(depth - 1, false);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                if (res) {
                    return [m, ...res];
                }
            }
            return null;
        } else {
            if (legalMoves.length === 0) return [];
            
            // Heuristic evaluation for White's moves
            // We want to pick moves that:
            // 1. Avoid immediate mate (handled by the search)
            // 2. Capture Sente's pieces
            // 3. Place defensive pieces near the King
            // 4. Avoid "early escapes" that make it easier for Sente to mate
            
            const isGoteUnderCheck = shogi.isCheck(Color.White);
            
            const evaluateMove = (m: any) => {
                let score = 0;
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                
                // Find White's King position
                let goteKingPos = { x: 0, y: 0 };
                for (let x = 1; x <= 9; x++) {
                    for (let y = 1; y <= 9; y++) {
                        const p = shogi.board[x - 1][y - 1];
                        if (p && p.kind === 'OU' && p.color === Color.White) {
                            goteKingPos = { x, y };
                        }
                    }
                }

                const movingPiece = m.from ? shogi.board[m.from.x - 1][m.from.y - 1] : null;
                const isKingMove = (movingPiece && movingPiece.kind === 'OU');

                if (m.from) {
                    // Capture evaluation
                    const targetPiece = shogi.board[m.to.x - 1][m.to.y - 1];
                    if (targetPiece && targetPiece.color === Color.Black) {
                        const PIECE_VALUES: Record<string, number> = {
                            'FU': 1, 'KY': 3, 'KE': 4, 'GI': 6, 'KI': 7, 'KA': 9, 'HI': 11,
                            'TO': 7, 'NY': 7, 'NK': 7, 'NG': 7, 'UM': 11, 'RY': 13
                        };
                        score += (PIECE_VALUES[targetPiece.kind] || 5) * 20; // Increased capture reward
                    }
                    
                    // Moving a piece closer to King defensively
                    const kind = movingPiece?.kind;
                    if (['KI', 'GI', 'FU', 'KA', 'HI'].includes(kind)) {
                        const distBefore = Math.abs(m.from.x - goteKingPos.x) + Math.abs(m.from.y - goteKingPos.y);
                        const distAfter = Math.abs(m.to.x - goteKingPos.x) + Math.abs(m.to.y - goteKingPos.y);
                        if (distAfter < distBefore) score += 15;
                    }
                } else {
                    // Dropping a piece defensive evaluation
                    if (['KI', 'GI', 'FU'].includes(m.piece)) {
                        const dist = Math.abs(m.to.x - goteKingPos.x) + Math.abs(m.to.y - goteKingPos.y);
                        if (dist <= 2) score += 30; // Strong reward for drops near King
                    }
                }

                // Temporary apply move for deep check
                try {
                    if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                    else shogi.drop(m.to.x, m.to.y, m.piece);
                    
                    // Penalty for King escape that leads to immediate check (if not necessary)
                    if (isKingMove && shogi.isCheck(Color.White)) {
                        score -= 60;
                    }

                    // Look for 1-move mate by Sente
                    const countSenteMates = () => {
                        let mateCount = 0;
                        const s2 = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                        const sMoves: any[] = [];
                        for (let x = 1; x <= 9; x++) {
                            for (let y = 1; y <= 9; y++) {
                                const p = shogi.board[x - 1][y - 1];
                                if (p && p.color === Color.Black) sMoves.push(...shogi.getMovesFrom(x, y));
                            }
                        }
                        const sDrops = shogi.getDropsBy(Color.Black);
                        for (const d of sDrops) {
                            for (let x = 1; x <= 9; x++) {
                                for (let y = 1; y <= 9; y++) {
                                    if (!shogi.board[x - 1][y - 1]) sMoves.push({ to: { x, y }, piece: d.kind, color: Color.Black });
                                }
                            }
                        }

                        for (const sm of sMoves) {
                            try {
                                if (sm.from) {
                                    // Handle promote appropriately inside the loop to avoid invalid moves
                                    try {
                                        shogi.move(sm.from.x, sm.from.y, sm.to.x, sm.to.y, sm.promote);
                                    } catch(e) { continue; }
                                }
                                else {
                                    try {
                                        shogi.drop(sm.to.x, sm.to.y, sm.piece);
                                    } catch(e) { continue; }
                                }
                                
                                if (shogi.isCheck(Color.White)) {
                                    // Check if White has ANY legal moves left
                                    let hasLegal = false;
                                    for (let x = 1; x <= 9 && !hasLegal; x++) {
                                        for (let y = 1; y <= 9 && !hasLegal; y++) {
                                            const p = shogi.board[x - 1][y - 1];
                                            if (p && p.color === Color.White) {
                                                const wms = shogi.getMovesFrom(x, y);
                                                for (const wm of wms) {
                                                    const s3 = shogi.toSFENString(1);
                                                    try {
                                                        shogi.move(x, y, wm.to.x, wm.to.y, wm.promote);
                                                        if (!shogi.isCheck(Color.White)) hasLegal = true;
                                                    } catch (e) {
                                                    } finally {
                                                        if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s3);
                                                        else shogi.initializeFromSFEN(s3);
                                                    }
                                                    if (hasLegal) break;
                                                }
                                            }
                                        }
                                    }
                                    if (!hasLegal) {
                                        const wds = shogi.getDropsBy(Color.White);
                                        for (const d of wds) {
                                            for (let x = 1; x <= 9 && !hasLegal; x++) {
                                                for (let y = 1; y <= 9 && !hasLegal; y++) {
                                                    if (!shogi.board[x - 1][y - 1]) {
                                                        const s3 = shogi.toSFENString(1);
                                                        try {
                                                            shogi.drop(x, y, d.kind);
                                                            if (!shogi.isCheck(Color.White)) hasLegal = true;
                                                        } catch(e) {
                                                        } finally {
                                                            if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s3);
                                                            else shogi.initializeFromSFEN(s3);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if (!hasLegal) mateCount++; // Found a mate-in-1 move for Sente
                                }
                            } catch(e) {
                            } finally {
                                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s2);
                                else shogi.initializeFromSFEN(s2);
                            }
                        }
                        return mateCount;
                    };

                    const mates = countSenteMates();
                    if (mates > 0) {
                        score -= 200 * mates; // Found mate-in-1 for Sente after this move
                        if (isKingMove) score -= 100 * mates; // Penalty for escaping into mate
                    }

                } finally {
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                    else shogi.initializeFromSFEN(s);
                }

                return score;
            };

            // Sort legal moves by heuristic score (descending)
            const scoredMoves = legalMoves.map(m => ({ move: m, score: evaluateMove(m) }));
            scoredMoves.sort((a, b) => b.score - a.score);

            let bestRes = null;
            let allMate = true;
            
            for (const item of scoredMoves) {
                const m = item.move;
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                else shogi.drop(m.to.x, m.to.y, m.piece);
                
                const res = search(depth - 1, true);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                
                if (!res) {
                    // This move does NOT lead to a mate (for Sente) within the search depth
                    // This is White's goal!
                    return [m]; // Immediate return as we found a non-mating line
                }
                
                // If this is the longest mate path so far, keep it
                if (!bestRes || res.length > bestRes.length) {
                    bestRes = [m, ...res];
                }
            }
            // If all moves lead to mate, bestRes will be the longest path (most resilient)
            return allMate ? bestRes : null;
        }
    }

    return search(maxDepth, true);
}
