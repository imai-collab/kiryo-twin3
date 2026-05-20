/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as ShogiModule from 'shogi.js';
import confetti from 'canvas-confetti';
import { Trophy, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, AlertCircle, Upload, Plus, Loader2, Edit2, Check, ArrowUp, ArrowDown, Trash2, ListOrdered, Copy, ClipboardCopy, Download, Settings, X, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { solveTsumeShogi, Move as SolverMove } from './lib/solver';
import problemsData from './data/problems.json';
import settingsData from './data/settings.json';

// Handle different export styles of shogi.js
const Shogi = (ShogiModule as any).Shogi || (ShogiModule as any).default || ShogiModule;
const Piece = (ShogiModule as any).Piece || (ShogiModule as any).default?.Piece;

// Define Color locally to avoid import issues
enum Color {
  Black = 0,
  White = 1,
}

// Piece display names (Kanji)
const PIECE_NAMES: Record<string, string> = {
  FU: '歩',
  KY: '香',
  KE: '桂',
  GI: '銀',
  KI: '金',
  KA: '角',
  HI: '飛',
  OU: '玉',
  TO: 'と',
  NY: '杏',
  NK: '圭',
  NG: '全',
  UM: '馬',
  RY: '龍',
};

const fillGoteHand = (shogiObj: any) => {
  const TOTAL_PIECES: Record<string, number> = { FU: 18, KY: 4, KE: 4, GI: 4, KI: 4, KA: 2, HI: 2 };
  const counts: Record<string, number> = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };

  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const p = shogiObj.get(x, y);
      if (p) {
        let kind = p.kind;
        if (['TO', 'NY', 'NK', 'NG'].includes(kind)) {
          if (kind === 'TO') kind = 'FU';
          if (kind === 'NY') kind = 'KY';
          if (kind === 'NK') kind = 'KE';
          if (kind === 'NG') kind = 'GI';
        }
        if (kind === 'UM') kind = 'KA';
        if (kind === 'RY') kind = 'HI';
        if (counts[kind] !== undefined) counts[kind]++;
      }
    }
  }

  const senteHand = shogiObj.getHandsSummary(Color.Black);
  for (const kind in senteHand) {
    if (counts[kind] !== undefined) counts[kind] += senteHand[kind];
  }

  const goteHand = shogiObj.getHandsSummary(Color.White);
  for (const kind in goteHand) {
    while (shogiObj.getHandsSummary(Color.White)[kind] > 0) {
      shogiObj.popFromHand(kind, Color.White);
    }
  }

  for (const kind in TOTAL_PIECES) {
    const remaining = TOTAL_PIECES[kind] - counts[kind];
    for (let i = 0; i < remaining; i++) {
      shogiObj.pushToHand(new Piece('-' + kind));
    }
  }
};

interface Position {
  x: number;
  y: number;
}

interface Move {
  from?: Position;
  to: Position;
  piece?: string;
  promote?: boolean;
}

interface Problem {
  id: number;
  title: string;
  description: string;
  initialSfen: string; // SFEN format for initial board
  solution?: Move[]; // Sequence of correct moves (user, response, user...)
}

const INITIAL_PROBLEMS: Problem[] = problemsData as Problem[];

const applyMoveToShogi = (shogiObj: any, move: Move) => {
  if (move.from) {
    shogiObj.move(move.from.x, move.from.y, move.to.x, move.to.y, move.promote);
  } else if (move.piece) {
    shogiObj.drop(move.to.x, move.to.y, move.piece);
  }
};

const cloneShogi = (shogiObj: any) => {
  const newShogi = new Shogi();
  const sfen = shogiObj.toSFENString ? shogiObj.toSFENString(1) : shogiObj.toSFEN(1);
  if (newShogi.initializeFromSFENString) {
    newShogi.initializeFromSFENString(sfen);
  } else if (newShogi.initializeFromSFEN) {
    newShogi.initializeFromSFEN(sfen);
  }
  return newShogi;
};

const getLegalMoves = (currentShogi: any, color: Color): Move[] => {
  const legalMoves: Move[] = [];
  
  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const boardPiece = currentShogi.get(x, y);
      if (boardPiece && boardPiece.color === color) {
        const pieceKind = boardPiece.kind;
        const pieceColor = boardPiece.color;
        const pseudoMoves = currentShogi.getMovesFrom(x, y);
        
        for (const pm of pseudoMoves) {
          const isPromotionZone = (c: Color, row: number) => c === Color.Black ? row <= 3 : row >= 7;
          const isPromoted = ["TO", "NY", "NK", "NG", "UM", "RY"].includes(pieceKind);
          const canPromote = !isPromoted && 
                             !['KI', 'OU', 'GY'].includes(pieceKind) &&
                             (isPromotionZone(pieceColor, y) || isPromotionZone(pieceColor, pm.to.y));
                             
          const mustPromote = canPromote && (
            (['FU', 'KY'].includes(pieceKind) && (pieceColor === Color.Black ? pm.to.y === 1 : pm.to.y === 9)) ||
            (pieceKind === 'KE' && (pieceColor === Color.Black ? pm.to.y <= 2 : pm.to.y >= 8))
          );

          if (!mustPromote) {
            const sfen1 = currentShogi.toSFENString(1);
            try {
              currentShogi.move(x, y, pm.to.x, pm.to.y, false);
              if (!currentShogi.isCheck(color)) {
                legalMoves.push({ from: { x, y }, to: { x: pm.to.x, y: pm.to.y }, promote: false });
              }
            } catch (e) {}
            if (currentShogi.initializeFromSFENString) {
              currentShogi.initializeFromSFENString(sfen1);
            } else {
              currentShogi.initializeFromSFEN(sfen1);
            }
          }

          if (canPromote || mustPromote) {
            const sfen2 = currentShogi.toSFENString(1);
            try {
              currentShogi.move(x, y, pm.to.x, pm.to.y, true);
              if (!currentShogi.isCheck(color)) {
                legalMoves.push({ from: { x, y }, to: { x: pm.to.x, y: pm.to.y }, promote: true });
              }
            } catch (e) {}
            if (currentShogi.initializeFromSFENString) {
              currentShogi.initializeFromSFENString(sfen2);
            } else {
              currentShogi.initializeFromSFEN(sfen2);
            }
          }
        }
      }
    }
  }

  const drops = currentShogi.getDropsBy(color);
  for (const drop of drops) {
    if (color === Color.Black) {
      if ((drop.kind === 'FU' || drop.kind === 'KY') && drop.to.y === 1) continue;
      if (drop.kind === 'KE' && drop.to.y <= 2) continue;
    } else {
      if ((drop.kind === 'FU' || drop.kind === 'KY') && drop.to.y === 9) continue;
      if (drop.kind === 'KE' && drop.to.y >= 8) continue;
    }

    if (drop.kind === 'FU') {
      let hasPawn = false;
      for (let y = 1; y <= 9; y++) {
        const p = currentShogi.get(drop.to.x, y);
        if (p && p.kind === 'FU' && p.color === color) {
          hasPawn = true;
          break;
        }
      }
      if (hasPawn) continue;
    }

    const sfen = currentShogi.toSFENString(1);
    try {
      currentShogi.drop(drop.to.x, drop.to.y, drop.kind);
      if (!currentShogi.isCheck(color)) {
        legalMoves.push({ to: { x: drop.to.x, y: drop.to.y }, piece: drop.kind });
      }
    } catch (e) {}
    if (currentShogi.initializeFromSFENString) {
      currentShogi.initializeFromSFENString(sfen);
    } else {
      currentShogi.initializeFromSFEN(sfen);
    }
  }

  return legalMoves;
};

const findBestDefenderMove = (currentShogi: any, maxDepth: number, aiMoveHistoryMap: Record<string, Move>): { bestMove: Move | null, steps: number, mate: boolean, mateCount?: number, timeout?: boolean } => {
  const memo = new Map<string, { steps: number, mate: boolean, bestMove: Move | null, mateCount?: number, timeout?: boolean }>();
  const startTime = Date.now();
  const TIME_LIMIT_MS = 3000;

  function search(depth: number, isBlack: boolean): { steps: number, mate: boolean, bestMove: Move | null, mateCount?: number, timeout?: boolean } {
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      return { steps: 0, mate: false, bestMove: null, mateCount: 0, timeout: true };
    }

    const sfen = currentShogi.toSFENString(1);
    const hash = `${sfen}-${depth}-${isBlack}`;
    if (memo.has(hash)) return memo.get(hash)!;

    if (depth === 0) {
      return { steps: 0, mate: false, bestMove: null, mateCount: 0 };
    }

    const color = isBlack ? Color.Black : Color.White;
    let legalMoves = getLegalMoves(currentShogi, color);

    // Sort moves to evaluate promising moves first, avoiding timeout with obscure moves
    const PIECE_VALUES: Record<string, number> = {
      FU: 1, KY: 3, KE: 4, GI: 6, KI: 7, KA: 10, HI: 12,
      TO: 7, NY: 7, NK: 7, NG: 7, UM: 12, RY: 14, OU: 1000
    };
    let goteKingPos = { x: 5, y: 1 };
    let senteKingPos = { x: 5, y: 9 };
    for (let x = 1; x <= 9; x++) {
      for (let y = 1; y <= 9; y++) {
        const p = currentShogi.get(x, y);
        if (p && p.kind === 'OU') {
          if (p.color === Color.White) goteKingPos = { x, y };
          else senteKingPos = { x, y };
        }
      }
    }

    const enemyKingPos = isBlack ? goteKingPos : senteKingPos;
    const myKingPos = isBlack ? senteKingPos : goteKingPos;

    legalMoves.sort((a, b) => {
      const scoreMove = (m: Move) => {
        let score = 0;
        if (m.from) {
          const captured = currentShogi.get(m.to.x, m.to.y);
          if (captured) score += (PIECE_VALUES[captured.kind] || 1) * 20; // Captures are good
          if (m.promote) score += 10;
          
          const piece = currentShogi.get(m.from.x, m.from.y);
          if (piece && !isBlack) {
            // Defense scaling
            const distBefore = Math.abs(m.from.x - myKingPos.x) + Math.abs(m.from.y - myKingPos.y);
            const distAfter = Math.abs(m.to.x - myKingPos.x) + Math.abs(m.to.y - myKingPos.y);
            if (distAfter < distBefore) score += 5; // Moving closer to own king
          } else if (piece && isBlack) {
             const distBefore = Math.abs(m.from.x - enemyKingPos.x) + Math.abs(m.from.y - enemyKingPos.y);
             const distAfter = Math.abs(m.to.x - enemyKingPos.x) + Math.abs(m.to.y - enemyKingPos.y);
             if (distAfter < distBefore) score += 5;
          }
        } else {
          // Drops
          score -= 10; // Penalty for using hand piece usually
          const dropVal = PIECE_VALUES[m.piece!] || 1;
          score += dropVal;
          if (!isBlack) {
             const dist = Math.abs(m.to.x - myKingPos.x) + Math.abs(m.to.y - myKingPos.y);
             if (dist <= 2) score += 15; // Defending near king
          } else {
             const dist = Math.abs(m.to.x - enemyKingPos.x) + Math.abs(m.to.y - enemyKingPos.y);
             if (dist <= 2) score += 15;
          }
        }
        return score;
      };
      return scoreMove(b) - scoreMove(a);
    });

    if (isBlack) {
      // 探索空間を減らすため、先手（プレイヤー）のシミュレーションは王手のみに絞る
      legalMoves = legalMoves.filter(m => {
        const s = currentShogi.toSFENString(1);
        applyMoveToShogi(currentShogi, m);
        const isCheck = currentShogi.isCheck(Color.White);
        if (currentShogi.initializeFromSFENString) {
          currentShogi.initializeFromSFENString(s);
        } else {
          currentShogi.initializeFromSFEN(s);
        }
        return isCheck;
      });

      if (legalMoves.length === 0) {
        const res = { steps: 0, mate: false, bestMove: null, mateCount: 0 };
        memo.set(hash, res);
        return res;
      }

      let bestSteps = Infinity;
      let bestMove: Move | null = null;
      let evaluatedBlackMoves = 0;
      let mateCount = 0;

      let timeout = false;

      for (const move of legalMoves) {
        if (Date.now() - startTime > TIME_LIMIT_MS) {
           timeout = true;
           break;
        }
        evaluatedBlackMoves++;
        
        if (move.piece === 'FU') {
           const s = currentShogi.toSFENString(1);
           applyMoveToShogi(currentShogi, move);
           const whiteMoves = getLegalMoves(currentShogi, Color.White);
           if (currentShogi.initializeFromSFENString) {
             currentShogi.initializeFromSFENString(s);
           } else {
             currentShogi.initializeFromSFEN(s);
           }
           if (whiteMoves.length === 0) {
             continue;
           }
        }

        const s = currentShogi.toSFENString(1);
        applyMoveToShogi(currentShogi, move);
        const res = search(depth - 1, false);
        if (currentShogi.initializeFromSFENString) {
          currentShogi.initializeFromSFENString(s);
        } else {
          currentShogi.initializeFromSFEN(s);
        }

        // If the deeper search timed out, we might not have found a mate, but it doesn't mean it's not mate.
        if (res.timeout) {
            timeout = true;
            break;
        }

        if (res.mate) {
          if (res.steps < bestSteps) {
            bestSteps = res.steps;
            bestMove = move;
            mateCount = 1;
          } else if (res.steps === bestSteps) {
            mateCount++;
          }
        }
      }

      const finalRes = bestMove ? { steps: bestSteps + 1, mate: true, bestMove, mateCount, timeout } : { steps: 0, mate: false, bestMove: null, mateCount: 0, timeout };
      memo.set(hash, finalRes);
      return finalRes;

    } else {
      if (legalMoves.length === 0) {
        const res = { steps: 0, mate: true, bestMove: null };
        memo.set(hash, res);
        return res;
      }

      let maxSteps = -1;
      let minMateCount = Infinity;
      let bestMoves: Move[] = [];
      let escapeMoves: Move[] = [];

      let timeout = false;

      for (const move of legalMoves) {
        if (Date.now() - startTime > TIME_LIMIT_MS) {
            timeout = true;
            break;
        }

        const s = currentShogi.toSFENString(1);
        applyMoveToShogi(currentShogi, move);
        const res = search(depth - 1, true);
        if (currentShogi.initializeFromSFENString) {
          currentShogi.initializeFromSFENString(s);
        } else {
          currentShogi.initializeFromSFEN(s);
        }

        if (res.timeout) {
           timeout = true;
           if (!res.mate) escapeMoves.push(move);
           break;
        }

        if (!res.mate) {
          escapeMoves.push(move);
        } else {
          const currentMateCount = res.mateCount || Infinity;
          if (res.steps > maxSteps) {
            maxSteps = res.steps;
            minMateCount = currentMateCount;
            bestMoves = [move];
          } else if (res.steps === maxSteps) {
            if (currentMateCount < minMateCount) {
              minMateCount = currentMateCount;
              bestMoves = [move];
            } else if (currentMateCount === minMateCount) {
              bestMoves.push(move);
            }
          }
        }
      }

      const sfenKey = currentShogi.toSFENString(1);
      const previousMove = aiMoveHistoryMap[sfenKey];

      const PIECE_VALUES: Record<string, number> = {
        FU: 1, KY: 3, KE: 4, GI: 6, KI: 7, KA: 10, HI: 12,
        TO: 7, NY: 7, NK: 7, NG: 7, UM: 12, RY: 14, OU: 1000
      };

      let goteKingPos = { x: 5, y: 1 };
      for (let x = 1; x <= 9; x++) {
        for (let y = 1; y <= 9; y++) {
          const p = currentShogi.get(x, y);
          if (p && p.kind === 'OU' && p.color === Color.White) {
            goteKingPos = { x, y };
          }
        }
      }

      const evaluateMoveOption = (m: Move) => {
         let score = 0;
         if (m.from) {
             const captured = currentShogi.get(m.to.x, m.to.y);
             if (captured) {
                score += (PIECE_VALUES[captured.kind] || 1) * 20;
             }
             const p = currentShogi.get(m.from.x, m.from.y);
             if (p && ['KI', 'GI', 'FU', 'KA', 'HI'].includes(p.kind)) {
                 const distBefore = Math.abs(m.from.x - goteKingPos.x) + Math.abs(m.from.y - goteKingPos.y);
                 const distAfter = Math.abs(m.to.x - goteKingPos.x) + Math.abs(m.to.y - goteKingPos.y);
                 if (distAfter < distBefore) score += 15;
             }
             if (p && p.kind === 'OU') score += 10; // slightly prefer king moving away from danger
         } else {
             score -= 10; // Penalty for dropping a piece
             const dist = Math.abs(m.to.x - goteKingPos.x) + Math.abs(m.to.y - goteKingPos.y);
             if (dist <= 2) score += 30; // Strongly prefer dropping near King
         }
         // Prevent repeating the same move immediately
         if (previousMove && m.from?.x === previousMove.from?.x && m.from?.y === previousMove.from?.y && m.to.x === previousMove.to.x && m.to.y === previousMove.to.y && m.piece === previousMove.piece && m.promote === previousMove.promote) {
           score -= 100;
         }
         return score + Math.random();
      };

      if (escapeMoves.length > 0) {
        let bestEscape = escapeMoves[0];
        let bestScore = -Infinity;

        for (const m of escapeMoves) {
          const score = evaluateMoveOption(m);
          if (score > bestScore) {
            bestScore = score;
            bestEscape = m;
          }
        }

        const escapeRes = { steps: 0, mate: false, bestMove: bestEscape, timeout };
        memo.set(hash, escapeRes);
        return escapeRes;
      }

      let randomBest = null;
      if (bestMoves.length > 0) {
        let bestDoomedMove = bestMoves[0];
        let bestDoomedScore = -Infinity;

        for (const m of bestMoves) {
           const score = evaluateMoveOption(m);
           if (score > bestDoomedScore) {
               bestDoomedScore = score;
               bestDoomedMove = m;
           }
        }
        randomBest = bestDoomedMove;
      }

      const finalRes = { steps: maxSteps + 1, mate: true, bestMove: randomBest, timeout };
      memo.set(hash, finalRes);
      return finalRes;
    }
  }

  return search(maxDepth, false);
};

export default function App() {
  const [appTitle, setAppTitle] = useState(settingsData.title || '詰将棋マスター');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      const localTitle = localStorage.getItem('tsumeShogiAppTitle');
      let apiTitle: string | null = null;
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.title) {
            apiTitle = data.title;
          }
        }
      } catch (e) {
        console.error("Failed to fetch settings from API", e);
      }

      const isApiDefault = apiTitle === settingsData.title;
      
      if (apiTitle && !isApiDefault) {
        setAppTitle(apiTitle);
        localStorage.setItem('tsumeShogiAppTitle', apiTitle);
      } else if (localTitle && localTitle !== settingsData.title) {
        setAppTitle(localTitle);
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: localTitle })
        }).catch(() => {});
      } else if (apiTitle) {
        setAppTitle(apiTitle);
      } else if (localTitle) {
        setAppTitle(localTitle);
      }
    };
    fetchSettings();
  }, []);

  const handleTitleSave = () => {
    if (tempTitle.trim()) {
      const newTitle = tempTitle.trim();
      setAppTitle(newTitle);
      localStorage.setItem('tsumeShogiAppTitle', newTitle);
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      }).catch(e => console.error("Failed to save settings to API", e));
    }
    setIsEditingTitle(false);
  };

  const [problems, setProblems] = useState<Problem[]>([]);
  const [isLoadingProblems, setIsLoadingProblems] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [shogi, setShogi] = useState<any>(null);
  const [selectedSquare, setSelectedSquare] = useState<Position | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ piece: string; color: Color } | null>(null);
  const [message, setMessage] = useState<string>('あなたの番です。');
  const [showCorrectSplash, setShowCorrectSplash] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [isGoteManualEntry, setIsGoteManualEntry] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPromotionMove, setPendingPromotionMove] = useState<Move | null>(null);
  const [sfenHistory, setSfenHistory] = useState<string[]>([]);
  const [aiMoveHistoryMap, setAiMoveHistoryMap] = useState<Record<string, Move>>({});
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [alertDialog, setAlertDialog] = useState<string | null>(null);
  const [sfenInputDialog, setSfenInputDialog] = useState(false);
  const [sfenInput, setSfenInput] = useState('');
  const [editTool, setEditTool] = useState<{ kind: string, color: Color } | 'eraser' | null>(null);
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);

  useEffect(() => {
    const fetchProblems = async () => {
      let apiProblems: Problem[] | null = null;
      try {
        const res = await fetch('/api/problems');
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            apiProblems = data;
          }
        }
      } catch (e) {
        console.error("Failed to fetch problems from API", e);
      }

      const saved = localStorage.getItem('tsumeShogiProblems');
      let localProblems: Problem[] | null = null;
      if (saved) {
        try {
          localProblems = JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse saved problems", e);
        }
      }

      // Handling ephemeral Dev Server resets:
      // If API returns default data, but we have local backup, restore local!
      const isApiDefault = JSON.stringify(apiProblems) === JSON.stringify(INITIAL_PROBLEMS);
      const hasLocalData = localProblems && localProblems.length > 0;
      
      if (apiProblems && apiProblems.length > 0 && !isApiDefault) {
        setProblems(apiProblems);
        localStorage.setItem('tsumeShogiProblems', JSON.stringify(apiProblems));
      } else if (hasLocalData) {
        setProblems(localProblems);
        // Sync to API so server is updated again
        fetch('/api/problems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localProblems)
        }).catch(() => {});
      } else if (apiProblems && apiProblems.length > 0) {
        setProblems(apiProblems);
      } else {
        setProblems(INITIAL_PROBLEMS);
      }
      
      setIsLoadingProblems(false);
    };
    fetchProblems();
  }, []);

  // Debounced auto-save to API and localStorage
  useEffect(() => {
    if (isLoadingProblems || problems.length === 0) return;

    const timer = setTimeout(() => {
      setIsSaving(true);
      localStorage.setItem('tsumeShogiProblems', JSON.stringify(problems));
      
      fetch('/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(problems)
      })
      .then(res => {
        if (!res.ok) throw new Error("Save failed");
        return res.json();
      })
      .catch(e => {
        console.error("Failed to save problems to API", e);
      })
      .finally(() => {
        // Show "Saved" for a moment
        setTimeout(() => setIsSaving(false), 800);
      });
    }, 1000); // 1 second debounce

    return () => clearTimeout(timer);
  }, [problems, isLoadingProblems]);

  const currentProblem = problems[currentProblemIndex];

  const handleAddEmptyProblem = () => {
    const newProblem: Problem = {
      id: Date.now(),
      title: `追加問題`,
      description: '新しい問題です。盤面を編集してください。',
      initialSfen: "9/9/9/9/9/9/9/9/9 b - 1",
    };
    setProblems(prev => {
      const updated = [...prev];
      updated.splice(currentProblemIndex + 1, 0, newProblem);
      return updated.map((p, i) => ({ ...p, id: i + 1 }));
    });
    setCurrentProblemIndex(currentProblemIndex + 1);
    setIsEditMode(true);
    setAlertDialog('新しい問題を追加しました。盤面を編集してください。');
  };

  const toggleEditMode = () => {
    if (isEditMode) {
      // Exiting edit mode, just save the new SFEN
      setSelectedSquare(null);
      const newSfen = shogi.toSFENString(1);
      const updatedProblems = [...problems];
      updatedProblems[currentProblemIndex] = {
        ...currentProblem,
        initialSfen: newSfen,
      };
      setProblems(updatedProblems);
      setAlertDialog(`盤面を更新しました。`);
    }
    setIsEditMode(!isEditMode);
  };

  const deleteProblem = () => {
    setConfirmDialog({
      message: 'この問題を削除しますか？',
      onConfirm: () => {
        const newProblems = problems.filter((_, idx) => idx !== currentProblemIndex);
        if (newProblems.length === 0) {
          setAlertDialog('最後の問題は削除できません。');
          return;
        }
        setProblems(newProblems);
        if (currentProblemIndex >= newProblems.length) {
          setCurrentProblemIndex(newProblems.length - 1);
        }
      }
    });
  };

  const moveProblemUp = () => {
    if (currentProblemIndex > 0) {
      const newProblems = [...problems];
      const temp = newProblems[currentProblemIndex];
      newProblems[currentProblemIndex] = newProblems[currentProblemIndex - 1];
      newProblems[currentProblemIndex - 1] = temp;
      setProblems(newProblems);
      setCurrentProblemIndex(currentProblemIndex - 1);
    }
  };

  const moveProblemDown = () => {
    if (currentProblemIndex < problems.length - 1) {
      const newProblems = [...problems];
      const temp = newProblems[currentProblemIndex];
      newProblems[currentProblemIndex] = newProblems[currentProblemIndex + 1];
      newProblems[currentProblemIndex + 1] = temp;
      setProblems(newProblems);
      setCurrentProblemIndex(currentProblemIndex + 1);
    }
  };

  const renumberProblems = () => {
    setConfirmDialog({
      message: 'すべての問題のタイトルを「第1問」「第2問」...と順番通りに振り直しますか？',
      onConfirm: () => {
        const newProblems = problems.map((p, idx) => ({
          ...p,
          id: idx + 1,
          title: `第${idx + 1}問`
        }));
        setProblems(newProblems);
        setAlertDialog('問題番号を振り直しました。');
      }
    });
  };

  const duplicateProblem = () => {
    const currentSfen = shogi.toSFENString(1);
    const newProblem = {
      ...currentProblem,
      id: Date.now(),
      title: `${currentProblem.title} (コピー)`,
      initialSfen: currentSfen,
    };
    
    setProblems(prev => {
      const updated = [...prev];
      if (isEditMode) {
        updated[currentProblemIndex] = {
          ...currentProblem,
          initialSfen: currentSfen
        };
      }
      updated.splice(currentProblemIndex + 1, 0, newProblem);
      return updated.map((p, idx) => ({ ...p, id: idx + 1 }));
    });
    setCurrentProblemIndex(currentProblemIndex + 1);
    setAlertDialog('問題を複製しました。現在の盤面データがコピーされています。');
  };

  const copyAllData = async () => {
    let currentDataToCopy = problems;
    if (isEditMode && shogi) {
      const currentSfen = shogi.toSFENString(1);
      currentDataToCopy = [...problems];
      currentDataToCopy[currentProblemIndex] = {
        ...currentProblem,
        initialSfen: currentSfen
      };
      setProblems(currentDataToCopy);
    }
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(currentDataToCopy, null, 2));
      setAlertDialog('すべての問題データをクリップボードにコピーしました！');
    } catch (err) {
      setAlertDialog('クリップボードへのコピーに失敗しました。');
    }
  };

  const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0].id !== 'undefined') {
          setConfirmDialog({
            message: 'JSONデータをインポートしますか？現在のデータはすべて上書きされます。',
            onConfirm: () => {
              setProblems(parsed);
              setCurrentProblemIndex(0);
              setAlertDialog('データをインポートしました。');
            }
          });
        } else {
          setUploadError('無効なJSONデータです。正しい形式の問題データを含めてください。');
        }
      } catch(err) {
        setUploadError('JSONデータの読み込みに失敗しました。ファイルが破損している可能性があります。');
      }
      if (jsonFileInputRef.current) jsonFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = error => reject(error);
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `提供されたファイル（画像またはPDF）に含まれるすべての将棋（詰将棋や必至など）の問題を読み取り、それぞれの盤面の状態と持ち駒からSFEN形式の文字列を作成してください。
また、図の上方や周辺に問題のタイトルや説明文（例：「基本の必至形 上から押さえる１」など）が書かれている場合は、そのテキストを読み取って \`description\` として抽出してください。特にテキストが見当たらない場合は空文字列にしてください。
さらに、後手（玉方）の持ち駒について、画像内で具体的に駒の種類と数が指定されている場合（例：「後手：金、銀」「後手：なし」など）は \`goteHandSpecified\` を true とし、指定がない場合（一般的な詰将棋のように「残り全部」が暗黙の前提となっている場合）は false としてください。

結果を以下のJSON配列形式で出力してください。

PDFの場合は複数ページに複数の問題がある可能性があります。すべての問題を抽出してください。

【重要：先手と後手の駒の判定（絶対に間違えないでください）】
画像内の駒の向きで先手・後手を判断します。
1. 先手の駒（攻め方・プレイヤー）:
   - 駒の文字が「正しく（正立して）」読める。
   - 駒の五角形の尖っている方向が「上（奥）」を向いている。
   - SFENでは **大文字** で出力（例: R, B, G, S, N, L, P, +R, +B, +S, +N, +L, +P）。

2. 後手の駒（受け方・玉方）:
   - 駒の文字が「逆さま」になっている。
   - 駒の五角形の尖っている方向が「下（手前）」を向いている。
   - ※玉将（玉）は通常こちらの向きです。
   - SFENでは **小文字** で出力（例: k, r, b, g, s, n, l, p, +r, +b, +s, +n, +l, +p）。

【SFEN形式のルール】
SFEN形式の例: 7nl/1R3sk2/5pppp/9/9/9/9/9/9 b GS 1
・先手の手番として 'b' を指定します。
・持ち駒（先手）は、大文字で指定してください（例: GS）。持ち駒がない場合は '-' を指定してください。
・空白は連続するマスの数を数字で表します（1〜9）。

出力は純粋なJSON配列のみにしてください。Markdownのコードブロック（\`\`\`json ... \`\`\`）や余計な説明は一切含めないでください。
例: [{"sfen": "7nl/1R3sk2/5pppp/9/9/9/9/9/9 b GS 1", "description": "基本の必至形 上から押さえる１", "goteHandSpecified": false}]`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data, mimeType: file.type } }
          ]
        }
      });

      const responseText = response.text?.trim() || "[]";
      const jsonStr = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      
      let parsedResults: { sfen: string, description: string, goteHandSpecified?: boolean }[] = [];
      try {
        parsedResults = JSON.parse(jsonStr);
        // 以前の、文字列配列だけが返ってきた場合のフォールバック（念のため）
        if (parsedResults.length > 0 && typeof parsedResults[0] === 'string') {
          parsedResults = (parsedResults as unknown as string[]).map(sfen => ({ sfen, description: '', goteHandSpecified: false }));
        }
      } catch (e) {
        if (jsonStr.includes('/') && jsonStr.includes(' ')) {
          parsedResults = [{ sfen: jsonStr, description: '', goteHandSpecified: false }];
        } else {
          throw new Error("SFEN文字列の抽出に失敗しました。");
        }
      }

      if (!parsedResults || parsedResults.length === 0) {
        throw new Error("問題が見つかりませんでした。");
      }

      const toFullWidth = (s: string) => s.replace(/[0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
      const newProblems: Problem[] = parsedResults.map((item, index) => {
        let finalSfen = item.sfen;
        if (!item.goteHandSpecified) {
          const tempShogi = new Shogi();
          try {
            if (tempShogi.initializeFromSFENString) {
              tempShogi.initializeFromSFENString(item.sfen);
            } else {
              tempShogi.initializeFromSFEN(item.sfen);
            }
            fillGoteHand(tempShogi);
            finalSfen = tempShogi.toSFENString ? tempShogi.toSFENString(1) : tempShogi.toSFEN(1);
          } catch (err) {
            console.error("Invalid SFEN from AI:", err);
          }
        }
        
        return {
          id: Date.now() + index,
          title: `問題${toFullWidth((index + 1).toString())}`,
          description: item.description ? item.description : 'ファイルから追加された問題です。',
          initialSfen: finalSfen,
        };
      });

      setProblems(prev => {
        const updated = [...prev];
        updated.splice(currentProblemIndex + 1, 0, ...newProblems);
        return updated.map((p, i) => ({ ...p, id: i + 1 }));
      });
      setCurrentProblemIndex(currentProblemIndex + 1);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadError(err.message || "ファイルの読み込みまたは解析に失敗しました。");
    } finally {
      setIsUploading(false);
    }
  };

  const resetGame = useCallback(() => {
    if (!currentProblem) return;
    
    try {
      const newShogi = new Shogi();
      
      // 常に後手番からスタートするようにSFENを書き換える
      let initialSfen = currentProblem.initialSfen;
      if (initialSfen.includes(' b ')) {
        initialSfen = initialSfen.replace(' b ', ' w ');
      }
      
      try {
        if (newShogi.initializeFromSFENString) {
          newShogi.initializeFromSFENString(initialSfen);
        } else if (newShogi.initializeFromSFEN) {
          newShogi.initializeFromSFEN(initialSfen);
        }
      } catch (sfenError) {
        console.error("Invalid SFEN:", initialSfen);
        // Initialize with empty board if SFEN is invalid
        if (newShogi.initializeFromSFENString) {
          newShogi.initializeFromSFENString("9/9/9/9/9/9/9/9/9 w - 1");
        } else {
          newShogi.initializeFromSFEN("9/9/9/9/9/9/9/9/9 w - 1");
        }
        setAlertDialog(`問題「${currentProblem.title}」の盤面データが不正なため、空の盤面を表示しています。「盤面を修正」から修正してください。`);
      }
      
      setShogi(newShogi);
      setSelectedSquare(null);
      setSelectedHandPiece(null);
      setMessage('後手の手を入力してください。');
      setIsGameOver(false);
      setIsGoteManualEntry(true);
      setMoveHistory([]);
      setError(null);
      setPendingPromotionMove(null);
      setSfenHistory([newShogi.toSFENString ? newShogi.toSFENString(1) : '']);
    } catch (e) {
      console.error("Game initialization error", e);
      setError("ゲームの初期化に失敗しました。");
    }
  }, [currentProblem]);

  const handleChangeGoteMove = useCallback(() => {
    if (moveHistory.length === 0) return;
    const isSentesTurn = moveHistory.length % 2 !== 0;
    
    if (!isSentesTurn) return;

    const newMoveHistory = [...moveHistory];
    const newSfenHistory = [...sfenHistory];
    
    newMoveHistory.pop();
    newSfenHistory.pop();

    const newShogi = new Shogi();
    if (newShogi.initializeFromSFENString) {
      newShogi.initializeFromSFENString(newSfenHistory[newSfenHistory.length - 1]);
    } else {
      newShogi.initializeFromSFEN(newSfenHistory[newSfenHistory.length - 1]);
    }
    
    setSfenHistory(newSfenHistory);
    setMoveHistory(newMoveHistory);
    setShogi(newShogi);
    
    setIsGoteManualEntry(true);
    setIsGameOver(false);
    setMessage('後手の手を入力してください。');
    setSelectedSquare(null);
    setSelectedHandPiece(null);
    setPendingPromotionMove(null);
  }, [moveHistory, sfenHistory]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  if (isLoadingProblems) {
    return (
      <div className="min-h-screen bg-[#fdf6e3] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-800 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-amber-800 font-bold">問題データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#fdf6e3] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-amber-950 mb-2">エラーが発生しました</h1>
          <p className="text-amber-800/70 mb-6">{error}</p>
          <div className="flex flex-col gap-3">
            <button onClick={() => window.location.reload()} className="bg-amber-800 text-white px-6 py-2 rounded-xl font-bold hover:bg-amber-900 transition-colors">
              再読み込み
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('tsumeShogiProblems');
                fetch('/api/problems', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(INITIAL_PROBLEMS)
                }).then(() => window.location.reload());
              }}
              className="px-6 py-2 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-colors text-sm"
            >
              データを初期化して復旧する
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!shogi) {
    return (
      <div className="min-h-screen bg-[#fdf6e3] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-800 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-amber-800 font-bold">読み込み中...</p>
        </div>
      </div>
    );
  }

  const handleSquareClick = (x: number, y: number) => {
    if (isEditMode) {
      if (editTool === 'eraser') {
        shogi.board[x - 1][y - 1] = null;
      } else if (editTool) {
        const prefix = editTool.color === Color.Black ? '+' : '-';
        shogi.board[x - 1][y - 1] = new Piece(prefix + editTool.kind);
      } else {
        if (selectedSquare) {
          if (selectedSquare.x === x && selectedSquare.y === y) {
            // Flip color if the same piece is clicked again
            const piece = shogi.get(x, y);
            if (piece) {
              shogi.board[x - 1][y - 1] = new Piece(piece.color === Color.Black ? '-' + piece.kind : '+' + piece.kind);
            }
            setSelectedSquare(null);
          } else {
            // Swap piece to the new square (moving it if empty, swapping if occupied)
            const pieceToMove = shogi.get(selectedSquare.x, selectedSquare.y);
            const targetPiece = shogi.get(x, y);
            shogi.board[selectedSquare.x - 1][selectedSquare.y - 1] = targetPiece;
            shogi.board[x - 1][y - 1] = pieceToMove;
            setSelectedSquare(null);
          }
        } else {
          // Select piece to move or flip
          if (shogi.get(x, y)) {
            setSelectedSquare({ x, y });
          }
          return; // Wait for the next click
        }
      }
      setShogi(cloneShogi(shogi));
      return;
    }

    if (isGameOver || pendingPromotionMove || message === '相手が考えています...') return;

    if (selectedHandPiece) {
      const to = { x, y };
      processMove({ to, piece: selectedHandPiece.piece });
      setSelectedHandPiece(null);
      return;
    }

    if (selectedSquare) {
      if (selectedSquare.x === x && selectedSquare.y === y) {
        setSelectedSquare(null);
        return;
      }

      const piece = shogi.get(selectedSquare.x, selectedSquare.y);
      if (!piece) {
        setSelectedSquare(null);
        return;
      }

      const pieceKind = piece.kind;
      const pieceColor = piece.color;

      const move: Move = { from: selectedSquare, to: { x, y }, promote: false };
      
      const isPromotionZone = (color: Color, row: number) => color === Color.Black ? row <= 3 : row >= 7;
      const isPromoted = ["TO", "NY", "NK", "NG", "UM", "RY"].includes(pieceKind);
      const canPromote = !isPromoted && 
                         !['KI', 'OU', 'GY'].includes(pieceKind) &&
                         (isPromotionZone(pieceColor, selectedSquare.y) || isPromotionZone(pieceColor, y));
                         
      const mustPromote = canPromote && (
        (['FU', 'KY'].includes(pieceKind) && (pieceColor === Color.Black ? y === 1 : y === 9)) ||
        (pieceKind === 'KE' && (pieceColor === Color.Black ? y <= 2 : y >= 8))
      );

      if (mustPromote) {
        move.promote = true;
        processMove(move);
        setSelectedSquare(null);
      } else if (canPromote) {
        setPendingPromotionMove(move);
      } else {
        processMove(move);
        setSelectedSquare(null);
      }
    } else {
      // Select a piece on the board
      const turnColor = isGoteManualEntry ? Color.White : Color.Black;
      const piece = shogi.get(x, y);
      if (piece && piece.color === turnColor) {
        setSelectedSquare({ x, y });
      }
    }
  };

  const handleHandClick = (piece: string, color: Color) => {
    const turnColor = isGoteManualEntry ? Color.White : Color.Black;
    if (isGameOver || color !== turnColor || message === '相手が考えています...') return;
    setSelectedSquare(null);
    setSelectedHandPiece({ piece, color });
  };

  const processMove = (move: Move) => {
    const turnColor = isGoteManualEntry ? Color.White : Color.Black;
    const opponentColor = isGoteManualEntry ? Color.Black : Color.White;

    setPendingPromotionMove(null);
    const sfenBefore = shogi.toSFENString(1);

    const legalMoves = getLegalMoves(shogi, turnColor);
    const isLegal = legalMoves.some(m => 
      m.from?.x === move.from?.x && m.from?.y === move.from?.y &&
      m.to?.x === move.to.x && m.to?.y === move.to.y &&
      m.piece === move.piece && m.promote === move.promote
    );

    if (!isLegal) {
      setMessage('その手は指せません（反則手です）。');
      setTimeout(() => setMessage(isGoteManualEntry ? '後手の手を入力してください。' : 'あなたの番です。'), 1500);
      return;
    }

    const tempShogi = cloneShogi(shogi);
    applyMoveToShogi(tempShogi, move);

    applyMoveToShogi(shogi, move);

    if (move.piece === 'FU' && shogi.isCheck(opponentColor)) {
      const oppMoves = getLegalMoves(shogi, opponentColor);
      if (oppMoves.length === 0) {
        shogi.initializeFromSFENString(sfenBefore);
        setMessage('打ち歩詰めは禁手です。');
        setTimeout(() => setMessage(isGoteManualEntry ? '後手の手を入力してください。' : 'あなたの番です。'), 2000);
        return;
      }
    }

    const newSfen = shogi.toSFENString(1);
    
    const count = sfenHistory.filter(s => s === newSfen).length;
    if (count >= 3) {
      setSfenHistory(prev => [...prev, newSfen]);
      setMoveHistory(prev => [...prev, move]);
      setShogi(cloneShogi(shogi));
      setIsGameOver(true);
      setMessage(isGoteManualEntry ? '千日手です。後手の失敗となります。' : '千日手です。攻め方の失敗となります。');
      return;
    }

    setSfenHistory(prev => [...prev, newSfen]);
    setMoveHistory(prev => [...prev, move]);
    
    const nextShogi = cloneShogi(shogi);
    setShogi(nextShogi);

    const oppMoves = getLegalMoves(nextShogi, opponentColor);
    if (oppMoves.length === 0) {
      setIsGameOver(true);
      if (turnColor === Color.White) {
        setMessage('指す手がありません。失敗です。');
      } else {
        setMessage('CORRECT');
        setShowCorrectSplash(true);
        setTimeout(() => setShowCorrectSplash(false), 1000);
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
      return;
    }

    if (isGoteManualEntry) {
       setIsGoteManualEntry(false);
       setMessage('あなたの番です。');
       return;
    }

    setMessage('相手が考えています...');
    
    setTimeout(() => {
      const sfenKey = nextShogi.toSFENString(1);
      const defenderRes = findBestDefenderMove(nextShogi, 3, aiMoveHistoryMap);
      
      if (defenderRes.bestMove) {
        setAiMoveHistoryMap(prev => ({ ...prev, [sfenKey]: defenderRes.bestMove! }));
        applyMoveToShogi(nextShogi, defenderRes.bestMove);
        const afterGoteSfen = nextShogi.toSFENString(1);
        setSfenHistory(prev => [...prev, afterGoteSfen]);
        setMoveHistory(prev => [...prev, defenderRes.bestMove!]);
        
        const blackMoves = getLegalMoves(nextShogi, Color.Black);
        if (blackMoves.length === 0) {
          setIsGameOver(true);
          setMessage('指す手がありません。失敗です。');
        } else {
          setMessage('あなたの番です。');
        }
        setShogi(cloneShogi(nextShogi));
      } else {
        setIsGameOver(true);
        setMessage('CORRECT');
        setShowCorrectSplash(true);
        setTimeout(() => setShowCorrectSplash(false), 1000);
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    }, 50);
  };

  const renderBoard = () => {
    const cells = [];
    for (let y = 1; y <= 9; y++) {
      for (let x = 9; x >= 1; x--) {
        const piece = shogi.get(x, y);
        const isSelected = selectedSquare?.x === x && selectedSquare?.y === y;
        const lastMove = moveHistory[moveHistory.length - 1];
        const isLastMove = lastMove?.to.x === x && lastMove?.to.y === y;

        cells.push(
          <div
            key={`${x}-${y}`}
            onClick={() => handleSquareClick(x, y)}
            className={`
              relative w-full aspect-square border border-amber-800/30 flex items-center justify-center cursor-pointer
              ${isSelected ? 'bg-amber-400/50' : isLastMove ? 'bg-amber-200/40' : 'hover:bg-amber-100/30'}
              transition-colors duration-200
            `}
          >
            {piece && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full h-full flex items-center justify-center p-0.5 sm:p-1"
              >
                <div
                  className={`
                    w-full h-full flex items-center justify-center rounded shadow-sm
                    ${piece.color === Color.Black 
                      ? 'bg-white border border-amber-800/30' 
                      : 'border border-transparent'
                    }
                    transition-all duration-200
                  `}
                >
                  <span className={`
                    text-xl sm:text-2xl md:text-3xl font-bold select-none
                    ${piece.color === Color.White ? 'rotate-180 text-amber-900' : 'text-amber-950'}
                  `}>
                    {PIECE_NAMES[piece.kind] || piece.kind}
                  </span>
                </div>
              </motion.div>
            )}
            {/* Coordinates for edge cells */}
          </div>
        );
      }
    }
    return cells;
  };

  const renderHand = (color: Color) => {
    const hand = shogi.getHandsSummary(color);
    const HAND_PIECES = ['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI'];
    const pieces = isEditMode
      ? HAND_PIECES.map(kind => [kind, hand[kind] || 0])
      : Object.entries(hand).filter(([_, count]) => (count as number) > 0);

    return (
      <div className="flex flex-row flex-wrap gap-1 sm:gap-2 items-center justify-center">
        {!isEditMode && pieces.length === 0 && <span className="text-amber-800/40 text-[10px] sm:text-sm italic py-2">なし</span>}
        {pieces.map(([kind, count]) => (
          <div key={kind} className="flex flex-col items-center gap-1">
            <div
              onClick={() => !isEditMode && handleHandClick(kind as string, color)}
              className={`
                relative flex items-center justify-center rounded
                ${color === Color.Black ? 'w-[10vw] max-w-[46px] h-[10vw] max-h-[46px] cursor-pointer border border-amber-800/30 bg-white/80 hover:bg-amber-100 shadow-sm' : 'w-8 h-8 sm:w-10 sm:h-10 bg-transparent'}
                ${selectedHandPiece?.piece === kind && selectedHandPiece?.color === color ? '!bg-amber-400/50' : ''}
                transition-all duration-200
              `}
            >
              <span className={`font-bold ${color === Color.White ? 'text-lg sm:text-xl rotate-180 text-amber-900' : 'text-xl sm:text-2xl md:text-3xl text-amber-950'} ${isEditMode && count === 0 ? 'opacity-30' : ''}`}>
                {PIECE_NAMES[kind as string] || kind}
              </span>
              {(count as number) > 1 && (
                <span className={`absolute -bottom-1 -right-1 text-[10px] sm:text-xs w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full border border-white ${color === Color.White ? 'bg-amber-900 text-white' : 'bg-amber-800 text-white'}`}>
                  {count as number}
                </span>
              )}
            </div>
            {isEditMode && (
              <div className="flex gap-1">
                <button 
                  onClick={() => {
                    if ((count as number) > 0) {
                      shogi.popFromHand(kind as string, color);
                      setShogi(cloneShogi(shogi));
                    }
                  }}
                  className="w-5 h-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                >-</button>
                <button 
                  onClick={() => {
                    shogi.pushToHand(new Piece((color === Color.Black ? '+' : '-') + kind));
                    setShogi(cloneShogi(shogi));
                  }}
                  className="w-5 h-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                >+</button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="h-[100dvh] bg-[#fdf6e3] text-amber-950 font-sans flex flex-col items-center overflow-hidden relative">
      {/* Custom Modals */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm w-full mx-4">
            <p className="text-lg font-bold mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {alertDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm w-full mx-4">
            <p className="text-lg font-bold mb-6">{alertDialog}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setAlertDialog(null)}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full bg-amber-200 py-2 px-4 flex justify-center items-center border-b-2 border-amber-900/20 shrink-0 shadow-sm">
        <span className="text-amber-950 font-black text-base sm:text-lg tracking-wide">©kiryoオリジナル詰将棋アプリ　２手詰③</span>
      </div>
      <header className="w-full flex-none px-2 sm:px-4 py-2 flex items-center justify-between shadow-sm z-10 bg-white/50 backdrop-blur-sm border-b border-amber-900/10">
        <button
          onClick={() => setCurrentProblemIndex(prev => Math.max(0, prev - 10))}
          disabled={currentProblemIndex === 0}
          className="p-1 sm:p-2 rounded-full hover:bg-amber-200 disabled:opacity-30 transition-colors"
          title="10問戻る"
        >
          <ChevronsLeft className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setCurrentProblemIndex(prev => Math.max(0, prev - 1))}
            disabled={currentProblemIndex === 0}
            className="p-1 sm:p-2 rounded-full hover:bg-amber-200 disabled:opacity-30 transition-colors"
            title="前の問題"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
          
          <div className="flex justify-center items-center gap-2 sm:gap-4 mx-1 sm:mx-2">
            <h2 className="text-base sm:text-lg md:text-xl font-bold text-amber-900 whitespace-nowrap">
              {currentProblem.title}
            </h2>
            <span className="font-bold px-3 py-1 bg-amber-200 rounded-full text-xs sm:text-sm whitespace-nowrap text-amber-900">
              問題 {currentProblemIndex + 1} / {problems.length}
            </span>
          </div>

          <button
            onClick={() => setCurrentProblemIndex(prev => Math.min(problems.length - 1, prev + 1))}
            disabled={currentProblemIndex === problems.length - 1}
            className="p-1 sm:p-2 rounded-full hover:bg-amber-200 disabled:opacity-30 transition-colors"
            title="次の問題"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        <button
          onClick={() => setCurrentProblemIndex(prev => Math.min(problems.length - 1, prev + 10))}
          disabled={currentProblemIndex === problems.length - 1}
          className="p-1 sm:p-2 rounded-full hover:bg-amber-200 disabled:opacity-30 transition-colors"
          title="10問進む"
        >
          <ChevronsRight className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      </header>

      <main className="flex-1 w-full min-h-0 flex flex-col items-center p-2 relative overflow-hidden">
        <div className="w-full max-w-lg flex flex-col gap-1 sm:gap-2 sm:gap-4 items-center justify-start h-full pb-16 pt-1 sm:pt-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Gote Hand (Top) */}
            <div className="w-full max-w-full sm:max-w-[480px] flex flex-row px-0 sm:px-2">
              <div className="w-full bg-amber-900/5 p-1 sm:p-3 rounded-lg sm:rounded-xl border border-amber-900/10 min-h-[40px] flex flex-row items-center gap-2 sm:gap-4">
                <h3 className="text-xs sm:text-sm font-bold text-amber-900/60 whitespace-nowrap ml-1 sm:ml-0">後手</h3>
                <div className="flex-1 flex flex-row justify-start flex-wrap">
                  {renderHand(Color.White)}
                </div>
              </div>
            </div>

            {/* Board */}
            <div className="flex flex-col items-center w-full">
              <div className={`relative w-full max-w-[min(100vw-16px,50vh)] p-0 sm:p-2 sm:rounded-lg shadow-sm sm:shadow-2xl border-y-2 sm:border-4 flex-shrink-0 transition-colors ${isEditMode ? 'bg-amber-100 border-amber-500' : 'bg-amber-100 sm:bg-amber-200 border-amber-800/20 sm:border-amber-800/20'}`}>
                {isEditMode && (
                  <div className="absolute top-0 left-0 right-0 bg-amber-500 text-white text-[10px] sm:text-xs font-bold text-center py-0.5 sm:py-1 sm:rounded-t-sm z-10">
                    盤面編集モード
                  </div>
                )}
                <div className={`grid grid-cols-9 w-full bg-amber-50 border-2 border-amber-900 shadow-inner align-top ${isEditMode ? 'mt-4 sm:mt-4' : ''}`}>
                  {renderBoard()}
                </div>
                <AnimatePresence>
                  {showCorrectSplash && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
                    >
                      <div className="bg-[#e4eed9]/95 border-[3px] border-[#a0c58e] rounded-full px-6 py-3 sm:px-10 sm:py-4 shadow-xl flex items-center gap-3 backdrop-blur-sm">
                        <Check className="w-8 h-8 sm:w-14 sm:h-14 text-[#66984e]" strokeWidth={2.5} />
                        <span className="text-3xl sm:text-5xl font-black text-[#66984e] tracking-widest">正解！</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Sente Hand (Bottom) */}
            <div className="w-full max-w-full sm:max-w-[480px] flex flex-row px-0 sm:px-2">
              <div className="w-full bg-amber-900/5 p-1 sm:p-3 rounded-lg sm:rounded-xl border border-amber-900/10 min-h-[40px] flex flex-row items-center gap-2 sm:gap-4">
                <h3 className="text-xs sm:text-sm font-bold text-amber-900/60 whitespace-nowrap ml-1 sm:ml-0">先手</h3>
                <div className="flex-1 flex flex-row justify-center flex-wrap">
                  {renderHand(Color.Black)}
                </div>
              </div>
            </div>
            
            {/* Message Area moved below Sente Hand */}
            <div className={`
              w-full max-w-full sm:max-w-[480px] p-2 sm:p-4 rounded-lg sm:rounded-xl text-center font-bold text-sm sm:text-lg transition-all duration-300 mx-2 sm:mx-0 shadow-sm
              ${isGameOver ? 'bg-green-100 text-green-800 scale-105' : 'bg-amber-100 border border-amber-200 text-amber-900'}
            `}>
              {message === 'CORRECT' ? (
                currentProblemIndex < problems.length - 1 ? (
                  <button 
                    onClick={() => {
                      setCurrentProblemIndex(prev => prev + 1);
                      // reset is handled by the useEffect watching currentProblemIndex
                    }}
                    className="w-full bg-green-600 text-white py-2 rounded-lg font-bold text-base hover:bg-green-700 transition-colors shadow-sm active:scale-95 flex items-center justify-center gap-2"
                  >
                    次の問題へ <ChevronRight size={18} />
                  </button>
                ) : (
                  <span className="text-green-800 text-sm sm:text-base block py-2">全問クリア！おめでとうございます🎉</span>
                )
              ) : (
                message
              )}
            </div>

            <div className="flex flex-row w-full max-w-full px-2 sm:px-0 sm:max-w-[480px] gap-2 mt-1 sm:mt-0">
              <button
                onClick={resetGame}
                className="flex-1 flex items-center justify-center gap-1 sm:gap-2 bg-amber-800 text-white py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-xs sm:text-base hover:bg-amber-900 transition-colors shadow-sm active:scale-95"
              >
                <RotateCcw size={14} className="sm:w-[18px] sm:h-[18px]" />
                最初から
              </button>
              <button
                onClick={handleChangeGoteMove}
                disabled={moveHistory.length === 0 || moveHistory.length % 2 === 0}
                className={`flex-1 flex items-center justify-center bg-gray-600 text-white py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-xs sm:text-base transition-colors shadow-sm active:scale-95 ${moveHistory.length === 0 || moveHistory.length % 2 === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'}`}
              >
                後手の手を変える
              </button>
            </div>

            {/* Comment Section below buttons */}
            <div className="w-full max-w-[600px] px-2 sm:px-0 mt-2 text-center z-10 shrink-0 pb-8">
              <p className="text-sm sm:text-base text-amber-950 whitespace-pre-wrap leading-relaxed font-bold bg-white/60 p-2 sm:p-3 rounded-xl border border-amber-900/10 shadow-sm">
                {currentProblem.description || "解説はありません"}
              </p>
            </div>

          {/* Edit Palette */}
          {isEditMode && (
            <div className="w-full max-w-[600px] px-2 sm:px-0">
              <div className="bg-white/80 p-4 rounded-xl border border-amber-300 shadow-sm">
                <h3 className="font-bold text-amber-900 mb-2">盤面編集ツール</h3>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setEditTool('eraser')}
                  className={`px-3 py-1 rounded border text-sm ${editTool === 'eraser' ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                >
                  消しゴム
                </button>
                <button
                  onClick={() => {
                    setEditTool(null);
                    setSelectedSquare(null);
                  }}
                  className={`px-3 py-1 rounded border text-sm ${editTool === null ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                >
                  移動 / 反転
                </button>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <div className="text-xs font-bold mb-1 text-amber-900">先手（黒）の駒を配置</div>
                  <div className="flex flex-wrap gap-1">
                    {['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI', 'OU', 'TO', 'NY', 'NK', 'NG', 'UM', 'RY'].map(kind => (
                      <button
                        key={`black-${kind}`}
                        onClick={() => setEditTool({ kind, color: Color.Black })}
                        className={`w-8 h-8 flex items-center justify-center border rounded text-sm ${editTool !== 'eraser' && editTool?.kind === kind && editTool?.color === Color.Black ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                      >
                        {PIECE_NAMES[kind]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold mb-1 text-amber-900">後手（白）の駒を配置</div>
                  <div className="flex flex-wrap gap-1">
                    {['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI', 'OU', 'TO', 'NY', 'NK', 'NG', 'UM', 'RY'].map(kind => (
                      <button
                        key={`white-${kind}`}
                        onClick={() => setEditTool({ kind, color: Color.White })}
                        className={`w-8 h-8 flex items-center justify-center border rounded text-sm ${editTool !== 'eraser' && editTool?.kind === kind && editTool?.color === Color.White ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                      >
                        <span className="rotate-180">{PIECE_NAMES[kind]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      </main>

      {/* Floating Toolbar Toggle */}
      <div className="absolute bottom-4 right-4 sm:bottom-8 sm:right-8 flex items-end gap-2 sm:gap-3 z-20 pointer-events-none">
        
        <button
          onClick={() => setIsToolbarOpen(true)}
          className="w-12 h-12 sm:w-14 sm:h-14 bg-amber-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-amber-700 hover:scale-105 active:scale-95 transition-all flex-shrink-0 pointer-events-auto"
          title="ツール・設定を開く"
        >
          <Menu size={24} className="sm:scale-110" />
        </button>
      </div>

      {/* Action Drawer */}
      <AnimatePresence>
        {isToolbarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setIsToolbarOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-[#fdf6e3] rounded-t-3xl shadow-2xl overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[#fdf6e3]/90 backdrop-blur pb-2 pt-4 px-6 border-b border-amber-900/10 flex justify-between items-center z-10">
                <h2 className="font-bold text-amber-900 text-lg">ツール・設定</h2>
                <button
                  onClick={() => setIsToolbarOpen(false)}
                  className="p-2 bg-amber-100 rounded-full text-amber-900 hover:bg-amber-200"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-6">
                {/* Info Column Restored */}
                <section className="bg-white/60 p-4 sm:p-6 rounded-xl border border-amber-200 shadow-sm flex flex-col gap-4">
                  {isEditMode ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-amber-700 block uppercase tracking-wider">問題タイトル</label>
                        <input
                          type="text"
                          value={currentProblem.title}
                          onChange={(e) => {
                            const updatedProblems = [...problems];
                            updatedProblems[currentProblemIndex] = {
                              ...currentProblem,
                              title: e.target.value,
                            };
                            setProblems(updatedProblems);
                          }}
                          className="w-full text-xl font-bold p-2 border border-amber-300 rounded-lg bg-white text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          placeholder="問題のタイトルを入力"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-amber-700 block uppercase tracking-wider">問題の説明 / 解説</label>
                        <textarea
                          value={currentProblem.description}
                          onChange={(e) => {
                            const updatedProblems = [...problems];
                            updatedProblems[currentProblemIndex] = {
                              ...currentProblem,
                              description: e.target.value,
                            };
                            setProblems(updatedProblems);
                          }}
                          className="w-full p-3 border border-amber-300 rounded-xl bg-white text-amber-900 mb-4 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          rows={4}
                          placeholder="問題の説明を入力してください"
                        />
                        <button 
                          onClick={toggleEditMode}
                          className="w-full bg-amber-600 text-white py-2 rounded-lg font-bold hover:bg-amber-700 transition-colors flex items-center justify-center gap-2"
                        >
                          <Check size={18} />
                          編集内容を確定
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-amber-800 leading-relaxed whitespace-pre-wrap border-b border-amber-900/10 pb-4">
                        {currentProblem.description}
                      </p>
                      <div className="flex justify-end">
                        <button 
                          onClick={toggleEditMode}
                          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded transition-colors bg-amber-200 text-amber-800 hover:bg-amber-300 font-bold"
                          title="盤面を編集する"
                        >
                          <Edit2 size={14} /> 盤面を修正
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap pt-2">
                        <button onClick={() => setShowInfo(!showInfo)} className="text-amber-600 hover:text-amber-800 flex items-center gap-1 text-sm font-bold bg-amber-100 px-2 py-1 rounded" title="ヒント">
                          <Info size={16} /> ヒント
                        </button>
                        <button onClick={moveProblemUp} disabled={currentProblemIndex === 0} className="p-1 text-amber-600 hover:bg-amber-200 rounded disabled:opacity-30" title="前に移動"><ArrowUp size={16} /></button>
                        <button onClick={moveProblemDown} disabled={currentProblemIndex === problems.length - 1} className="p-1 text-amber-600 hover:bg-amber-200 rounded disabled:opacity-30" title="後ろに移動"><ArrowDown size={16} /></button>
                        <button onClick={renumberProblems} className="p-1 text-amber-600 hover:bg-amber-200 rounded" title="問題番号を順番通りに振り直す"><ListOrdered size={16} /></button>
                        <button onClick={duplicateProblem} className="p-1 text-amber-600 hover:bg-amber-200 rounded" title="この問題を複製"><Copy size={16} /></button>
                        <button onClick={deleteProblem} className="p-1 text-red-500 hover:bg-red-100 rounded" title="この問題を削除"><Trash2 size={16} /></button>
                      </div>
                    </>
                  )}
                </section>

                <AnimatePresence>
                  {showInfo && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-sm text-blue-800"
                    >
                      <p><strong>ヒント:</strong> 相手の玉を逃げ場のない状態（詰み）にしてください。王手以外の手（必至など）を指すことも可能です。</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Upload Section */}
                <div className="w-full">
                  <div className="bg-white/60 p-4 rounded-xl border border-amber-200 shadow-sm flex flex-col items-center justify-between gap-4">
                    <div className="flex flex-col items-start gap-4 text-amber-900 w-full">
                      <div className="flex items-center gap-2">
                        <Upload size={20} />
                        <span className="font-bold text-sm">問題を追加・エクスポートする</span>
                      </div>
                      
                      <div className="flex flex-wrap gap-2 w-full">
                        <button
                          onClick={copyAllData}
                          className="flex items-center justify-center gap-2 text-sm text-amber-700 hover:text-amber-900 bg-white px-3 py-1.5 rounded-md border border-amber-300 shadow-sm transition-colors flex-1"
                          title="現在の問題データをクリップボードにコピー"
                        >
                          <ClipboardCopy size={16} />
                          データをコピー
                        </button>

                        <input
                          type="file"
                          accept="application/json"
                          className="hidden"
                          ref={jsonFileInputRef}
                          onChange={handleJsonImport}
                        />
                        <button
                          onClick={() => jsonFileInputRef.current?.click()}
                          className="flex items-center justify-center gap-2 text-sm text-amber-700 hover:text-amber-900 bg-white px-3 py-1.5 rounded-md border border-amber-300 shadow-sm transition-colors flex-1"
                          title="JSONファイルから問題データをインポート"
                        >
                          <Download size={16} />
                          インポート
                        </button>

                        <button
                          onClick={() => {
                            if (problems.length <= 1) {
                              setAlertDialog('削除できる問題がありません。');
                              return;
                            }
                            setConfirmDialog({
                              message: '第1問以外のすべての問題を削除しますか？\n(この操作は取り消せません)',
                              onConfirm: () => {
                                const newProblems = [problems[0]];
                                setProblems(newProblems);
                                setCurrentProblemIndex(0);
                                localStorage.setItem('tsumeShogiProblems', JSON.stringify(newProblems));
                                setAlertDialog('第1問以外の問題をすべて削除しました。');
                              }
                            });
                          }}
                          className="flex items-center justify-center gap-2 text-sm text-red-700 hover:text-red-900 bg-red-50 px-3 py-1.5 rounded-md border border-red-200 shadow-sm transition-colors w-full mt-2"
                          title="第1問以外のすべての問題を削除する"
                        >
                          <RotateCcw size={16} />
                          初期化
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 w-full mt-2 pt-4 border-t border-amber-900/10">
                      <button
                        onClick={handleAddEmptyProblem}
                        className="w-full flex items-center justify-center gap-2 bg-amber-100 text-amber-900 px-4 py-2 rounded-lg font-bold hover:bg-amber-200 transition-colors"
                      >
                        <Plus size={18} />
                        空の盤面を追加
                      </button>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="w-full flex items-center justify-center gap-2 bg-amber-100 text-amber-900 px-4 py-2 rounded-lg font-bold hover:bg-amber-200 transition-colors disabled:opacity-50"
                      >
                        {isUploading ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Upload size={18} />
                        )}
                        {isUploading ? '解析中...' : '画像/PDFから追加'}
                      </button>
                    </div>
                  </div>
                  {uploadError && (
                    <div className="mt-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2">
                      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                      <span>{uploadError}</span>
                    </div>
                  )}
                </div>

                <footer className="text-center text-amber-900 font-bold text-sm py-4 pb-8">
                  ©kiryoオリジナル詰将棋アプリ　２手詰③
                </footer>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Promotion Dialog */}
      <AnimatePresence>
        {pendingPromotionMove && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-6 max-w-sm w-full"
            >
              <h3 className="text-2xl font-bold text-amber-900">成りますか？</h3>
              <div className="flex gap-4 w-full">
                <button
                  onClick={() => {
                    const move = { ...pendingPromotionMove, promote: true };
                    processMove(move);
                    setSelectedSquare(null);
                  }}
                  className="flex-1 py-4 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-colors text-lg shadow-md"
                >
                  成る
                </button>
                <button
                  onClick={() => {
                    const move = { ...pendingPromotionMove, promote: false };
                    processMove(move);
                    setSelectedSquare(null);
                  }}
                  className="flex-1 py-4 bg-gray-200 text-gray-800 font-bold rounded-xl hover:bg-gray-300 transition-colors text-lg shadow-md"
                >
                  成らず
                </button>
              </div>
              <button
                onClick={() => {
                  setPendingPromotionMove(null);
                  setSelectedSquare(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-700 underline mt-2"
              >
                キャンセル
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
