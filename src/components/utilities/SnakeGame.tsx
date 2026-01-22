import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gamepad2, RotateCcw, Pause, Play, Zap } from "lucide-react";

const CELL_SIZE = 16;
const GRID_SIZE = 20;
const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;
const BASE_SPEED = 8;
const SPEED_STEP = 0.35;
const MAX_SPEED = 18;

type Direction = { x: number; y: number };
type Position = { x: number; y: number };

enum GameState {
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  OVER = "GAME OVER",
}

export function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>(GameState.RUNNING);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem("nokia_snake_highscore_v1");
    return saved ? parseInt(saved, 10) : 0;
  });
  const [wrapWalls, setWrapWalls] = useState(false);

  // Game state refs (for animation loop)
  const snakeRef = useRef<Position[]>([]);
  const dirRef = useRef<Direction>({ x: 1, y: 0 });
  const nextDirRef = useRef<Direction>({ x: 1, y: 0 });
  const foodRef = useRef<Position>({ x: 0, y: 0 });
  const speedRef = useRef(BASE_SPEED);
  const scoreRef = useRef(0);
  const gameStateRef = useRef<GameState>(GameState.RUNNING);
  const wrapWallsRef = useRef(false);
  const accumulatorRef = useRef(0);
  const lastTimeRef = useRef(0);

  const spawnFood = useCallback(() => {
    while (true) {
      const x = Math.floor(Math.random() * GRID_SIZE);
      const y = Math.floor(Math.random() * GRID_SIZE);
      const onSnake = snakeRef.current.some((s) => s.x === x && s.y === y);
      if (!onSnake) {
        foodRef.current = { x, y };
        return;
      }
    }
  }, []);

  const resetGame = useCallback(() => {
    const startX = Math.floor(GRID_SIZE / 2);
    const startY = Math.floor(GRID_SIZE / 2);
    snakeRef.current = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    dirRef.current = { x: 1, y: 0 };
    nextDirRef.current = { x: 1, y: 0 };
    scoreRef.current = 0;
    speedRef.current = BASE_SPEED;
    setScore(0);
    spawnFood();
    setGameState(GameState.RUNNING);
    gameStateRef.current = GameState.RUNNING;
    canvasRef.current?.focus();
  }, [spawnFood]);

  const tick = useCallback(() => {
    if (gameStateRef.current !== GameState.RUNNING) return;

    dirRef.current = { ...nextDirRef.current };
    const head = snakeRef.current[0];
    let nx = head.x + dirRef.current.x;
    let ny = head.y + dirRef.current.y;

    if (wrapWallsRef.current) {
      if (nx < 0) nx = GRID_SIZE - 1;
      if (nx >= GRID_SIZE) nx = 0;
      if (ny < 0) ny = GRID_SIZE - 1;
      if (ny >= GRID_SIZE) ny = 0;
    } else {
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) {
        setGameState(GameState.OVER);
        gameStateRef.current = GameState.OVER;
        return;
      }
    }

    const hitsSelf = snakeRef.current.some((seg) => seg.x === nx && seg.y === ny);
    if (hitsSelf) {
      setGameState(GameState.OVER);
      gameStateRef.current = GameState.OVER;
      return;
    }

    snakeRef.current.unshift({ x: nx, y: ny });

    if (nx === foodRef.current.x && ny === foodRef.current.y) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      if (scoreRef.current > highScore) {
        setHighScore(scoreRef.current);
        localStorage.setItem("nokia_snake_highscore_v1", String(scoreRef.current));
      }
      spawnFood();
      speedRef.current = Math.min(MAX_SPEED, BASE_SPEED + scoreRef.current * SPEED_STEP);
    } else {
      snakeRef.current.pop();
    }
  }, [highScore, spawnFood]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = "hsl(220 30% 6%)";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Grid
    ctx.strokeStyle = "hsl(215 40% 14%)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_SIZE; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL_SIZE + 0.5, 0);
      ctx.lineTo(x * CELL_SIZE + 0.5, CANVAS_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_SIZE; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL_SIZE + 0.5);
      ctx.lineTo(CANVAS_SIZE, y * CELL_SIZE + 0.5);
      ctx.stroke();
    }

    // Food
    ctx.fillStyle = "hsl(348 83% 60%)";
    fillCell(ctx, foodRef.current.x, foodRef.current.y, 0.18);

    // Snake
    for (let i = snakeRef.current.length - 1; i >= 0; i--) {
      const seg = snakeRef.current[i];
      ctx.fillStyle = i === 0 ? "hsl(147 76% 68%)" : "hsl(147 65% 50%)";
      fillCell(ctx, seg.x, seg.y, i === 0 ? 0.12 : 0.16);
    }

    // Overlay
    if (gameStateRef.current !== GameState.RUNNING) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "bold 18px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        gameStateRef.current === GameState.PAUSED ? "PAUSADO" : "GAME OVER",
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2 - 10
      );
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.80)";
      ctx.fillText(
        "Space: Continuar • R: Reiniciar",
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2 + 16
      );
    }
  }, []);

  const fillCell = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    insetRatio = 0.16
  ) => {
    const inset = CELL_SIZE * insetRatio;
    const x = cx * CELL_SIZE + inset;
    const y = cy * CELL_SIZE + inset;
    const w = CELL_SIZE - inset * 2;
    const h = CELL_SIZE - inset * 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
  };

  const handleDirection = useCallback((inputDir: Direction) => {
    const isOpposite =
      inputDir.x === -dirRef.current.x && inputDir.y === -dirRef.current.y;
    if (!isOpposite) {
      nextDirRef.current = inputDir;
    }
  }, []);

  const togglePause = useCallback(() => {
    if (gameStateRef.current === GameState.OVER) return;
    const newState =
      gameStateRef.current === GameState.PAUSED
        ? GameState.RUNNING
        : GameState.PAUSED;
    setGameState(newState);
    gameStateRef.current = newState;
  }, []);

  // Game loop
  useEffect(() => {
    resetGame();

    let animationId: number;

    const loop = (timestamp: number) => {
      const dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      if (gameStateRef.current === GameState.RUNNING) {
        accumulatorRef.current += dt;
        const step = 1 / speedRef.current;
        while (accumulatorRef.current >= step) {
          tick();
          accumulatorRef.current -= step;
        }
      }

      draw();
      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationId);
  }, [resetGame, tick, draw]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(
          e.key.toLowerCase()
        )
      ) {
        e.preventDefault();
      }

      if (key === " " || key === "spacebar") togglePause();
      if (key === "r") resetGame();

      if (key === "arrowup" || key === "w") handleDirection({ x: 0, y: -1 });
      if (key === "arrowdown" || key === "s") handleDirection({ x: 0, y: 1 });
      if (key === "arrowleft" || key === "a") handleDirection({ x: -1, y: 0 });
      if (key === "arrowright" || key === "d") handleDirection({ x: 1, y: 0 });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDirection, togglePause, resetGame]);

  // Sync wrap walls ref
  useEffect(() => {
    wrapWallsRef.current = wrapWalls;
  }, [wrapWalls]);

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="h-5 w-5" />
              Snake
            </CardTitle>
            <CardDescription>
              Un descanso para abogados trabajadores
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">
              Puntos: <span className="font-bold ml-1">{score}</span>
            </Badge>
            <Badge variant="outline">
              Mejor: <span className="font-bold ml-1">{highScore}</span>
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            tabIndex={0}
            className="rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            style={{
              imageRendering: "pixelated",
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          <Button variant="outline" size="sm" onClick={resetGame}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reiniciar (R)
          </Button>
          <Button variant="outline" size="sm" onClick={togglePause}>
            {gameState === GameState.PAUSED ? (
              <>
                <Play className="h-4 w-4 mr-2" />
                Continuar
              </>
            ) : (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Pausar
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWrapWalls(!wrapWalls)}
          >
            <Zap className="h-4 w-4 mr-2" />
            Paredes: {wrapWalls ? "OFF (Wrap)" : "ON"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Usa <kbd className="px-1 py-0.5 rounded bg-muted text-xs">↑ ↓ ← →</kbd> o{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted text-xs">W A S D</kbd>.
          Pausa con <kbd className="px-1 py-0.5 rounded bg-muted text-xs">Space</kbd>.
        </p>
      </CardContent>
    </Card>
  );
}