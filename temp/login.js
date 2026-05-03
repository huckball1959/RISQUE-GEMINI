function logToConsole(message) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const logEntry = `[${timestamp}] [Login] ${message}`;
  console.log(logEntry);
  const logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
  logs.push(logEntry);
  localStorage.setItem("gameLogs", JSON.stringify(logs));
}

function validateGameState(gameState) {
  const requiredFields = ["phase", "players", "turnOrder", "currentPlayer", "round", "aerialAttack", "aerialBridge", "conquered", "deck", "isInitialDeploy", "continents"];
  const isValid = gameState &&
    requiredFields.every(field => gameState.hasOwnProperty(field)) &&
    gameState.players.length >= 0 &&
    gameState.turnOrder.length === gameState.players.length &&
    (gameState.currentPlayer === null || gameState.turnOrder.includes(gameState.currentPlayer)) &&
    gameState.deck.length <= 44 &&
    Object.keys(gameState.continents).length === 6 &&
    ["south_america", "north_america", "africa", "europe", "asia", "australia"].every(c => gameState.continents[c]);
  logToConsole(`Game state valid: ${isValid}${isValid ? "" : ", errors: " + JSON.stringify({
    missingFields: requiredFields.filter(f => !gameState.hasOwnProperty(f)),
    playerCount: gameState.players ? gameState.players.length : 0,
    turnOrderMatch: gameState.turnOrder && gameState.players ? gameState.turnOrder.length === gameState.players.length : false,
    deckLength: gameState.deck ? gameState.deck.length : 0,
    continentsCount: gameState.continents ? Object.keys(gameState.continents).length : 0
  })}`);
  return isValid;
}

function initializeGameState() {
  localStorage.removeItem("gameState"); // Clear to prevent extra fields
  let gameState = {
    phase: "login",
    players: [],
    turnOrder: [],
    currentPlayer: null,
    round: 1,
    aerialAttack: false,
    aerialAttackEligible: false,
    aerialBridge: null,
    conquered: false,
    deck: [
      "afghanistan", "alaska", "alberta", "argentina", "brazil", "central_america",
      "china", "congo", "east_africa", "eastern_australia", "eastern_united_states",
      "egypt", "great_britain", "greenland", "iceland", "india", "indonesia",
      "irkutsk", "japan", "kamchatka", "madagascar", "middle_east", "mongolia",
      "new_guinea", "north_africa", "northern_europe", "northwest_territory",
      "ontario", "peru", "quebec", "scandinavia", "siam", "siberia",
      "south_africa", "southern_europe", "ukraine", "ural", "venezuela",
      "western_australia", "western_europe", "western_united_states", "yakutsk",
      "wildcard1", "wildcard2"
    ],
    isInitialDeploy: true,
    continents: {
      south_america: { bonus: 2 },
      north_america: { bonus: 5 },
      africa: { bonus: 3 },
      europe: { bonus: 5 },
      asia: { bonus: 7 },
      australia: { bonus: 2 }
    }
  };
  localStorage.setItem("gameState", JSON.stringify(gameState));
  logToConsole("Game state initialized: " + JSON.stringify(gameState, null, 2));
  validateGameState(gameState);
}

function resizeCanvas() {
  const canvas = document.querySelector(".canvas-wrapper");
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  let scale = Math.min(windowWidth / 1920, windowHeight / 1080);
  scale = Math.max(0.5, Math.min(1.0, scale));
  canvas.style.transform = `translateX(-50%) scale(${scale})`;
  logToConsole(`Canvas resized: scale=${scale}, width=${windowWidth}, height=${windowHeight}`);
}

function getTargetRow() {
  const rows = document.querySelectorAll(".player-row");
  for (const row of rows) {
    const input = row.querySelector("input");
    const colorField = row.querySelector(".color-field");
    if (input.value.trim() !== "" && colorField.dataset.color === "") {
      return row;
    }
  }
  return null;
}

document.addEventListener("DOMContentLoaded", () => {
  localStorage.setItem("gameLogs", JSON.stringify([]));
  resizeCanvas();
  initializeGameState();

  const inputs = document.querySelectorAll(".player-row input");
  const swatches = document.querySelectorAll(".color-swatch");
  const loginButton = document.getElementById("login-button");
  const loadButton = document.querySelector(".load-button");
  const canvas = document.getElementById("canvas");

  inputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      logToConsole(`Player ${index + 1} name entered: ${input.value.trim()}`);
    });
  });

  swatches.forEach(swatch => {
    swatch.addEventListener("click", () => {
      if (!swatch.classList.contains("active")) return;
      const color = swatch.dataset.color;
      const row = getTargetRow();
      if (!row) {
        logToConsole("No valid row for color selection");
        return;
      }
      const playerIndex = Array.from(document.querySelectorAll(".player-row")).indexOf(row) + 1;
      const colorField = row.querySelector(".color-field");
      colorField.style.background = getComputedStyle(swatch).background;
      colorField.dataset.color = color;
      swatch.classList.remove("active");
      swatch.classList.add("unavailable");
      logToConsole(`Player ${playerIndex} selected color: ${color}`);
    });
  });

  document.querySelectorAll(".color-field").forEach(field => {
    field.addEventListener("click", () => {
      const color = field.dataset.color;
      if (!color) return;
      const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
      const row = field.closest(".player-row");
      const playerIndex = Array.from(document.querySelectorAll(".player-row")).indexOf(row) + 1;
      field.style.background = "transparent";
      field.dataset.color = "";
      swatch.classList.remove("unavailable");
      swatch.classList.add("active");
      logToConsole(`Player ${playerIndex} deselected color: ${color}`);
    });
  });

  loginButton.addEventListener("click", () => {
    logToConsole("LOG IN clicked");
    const rows = document.querySelectorAll(".player-row");
    const filledRows = Array.from(rows).filter(row => {
      const input = row.querySelector("input");
      const colorField = row.querySelector(".color-field");
      return input.value.trim() !== "" && colorField.dataset.color !== "";
    });

    if (filledRows.length < 2) {
      logToConsole("Login failed: At least two players required");
      return;
    }

    const names = filledRows.map(row => row.querySelector("input").value.trim());
    const colors = filledRows.map(row => row.querySelector(".color-field").dataset.color);
    if (new Set(names).size !== names.length) {
      logToConsole("Login failed: Duplicate names detected");
      return;
    }
    if (new Set(colors).size !== colors.length) {
      logToConsole("Login failed: Colors must be unique");
      return;
    }

    const gameState = {
      phase: "deal",
      players: filledRows.map((row, index) => ({
        name: row.querySelector("input").value.trim(),
        color: row.querySelector(".color-field").dataset.color,
        playerOrder: index + 1,
        bookValue: 0,
        continentValues: {},
        bankValue: filledRows.length === 2 ? 40 : filledRows.length === 3 ? 35 :
                   filledRows.length === 4 ? 30 : filledRows.length === 5 ? 25 : 20,
        cardCount: 0,
        cards: [],
        territories: [],
        troopsTotal: 0,
        confirmed: false
      })),
      turnOrder: filledRows.map(row => row.querySelector("input").value.trim()),
      currentPlayer: null,
      round: 1,
      aerialAttack: false,
      aerialAttackEligible: false,
      aerialBridge: null,
      conquered: false,
      deck: [
        "afghanistan", "alaska", "alberta", "argentina", "brazil", "central_america",
        "china", "congo", "east_africa", "eastern_australia", "eastern_united_states",
        "egypt", "great_britain", "greenland", "iceland", "india", "indonesia",
        "irkutsk", "japan", "kamchatka", "madagascar", "middle_east", "mongolia",
        "new_guinea", "north_africa", "northern_europe", "northwest_territory",
        "ontario", "peru", "quebec", "scandinavia", "siam", "siberia",
        "south_africa", "southern_europe", "ukraine", "ural", "venezuela",
        "western_australia", "western_europe", "western_united_states", "yakutsk",
        "wildcard1", "wildcard2"
      ],
      isInitialDeploy: true,
      continents: {
        south_america: { bonus: 2 },
        north_america: { bonus: 5 },
        africa: { bonus: 3 },
        europe: { bonus: 5 },
        asia: { bonus: 7 },
        australia: { bonus: 2 }
      }
    };
    localStorage.setItem("gameState", JSON.stringify(gameState));
    logToConsole("Game state updated: " + JSON.stringify(gameState, null, 2));
    validateGameState(gameState);

    canvas.classList.add("fade-out");
    setTimeout(() => {
      logToConsole("Redirecting to player1a.html");
      window.location.href = "player1a.html";
    }, 1000);
  });

  loadButton.addEventListener("click", () => {
    logToConsole("LOAD GAME clicked, navigating to game080625.json");
    window.location.href = "game080625.json";
  });
});

window.addEventListener("resize", resizeCanvas);
document.addEventListener("fullscreenchange", resizeCanvas);