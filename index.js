const app = require("express")();
const cors = require("cors");
const httpServer = require("http").createServer(app);
const io = require("socket.io")(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5000;

app.use(cors());

app.get("/", (req, res) => {
  res.send("I'm alive");
});

let users = 0;
let lobbies = [
  {
    admin: "Hk02Vyv4vmNWR7EkL963mkmSQdq1",
    lobbyName: "test lobby",
    players: [],
    stage: 0,
    round: 0,
  },
];

/* Checks if provided value equals any value of provided attrib in
 provided array and if true, returns object where it's true */
const isValueInArrayOfObjects = (array, attrib, value) => {
  let result = [];
  array.forEach((obj) => {
    if (obj[attrib] === value) {
      result.push(obj);
    }
  });
  if (result.length === 0) {
    result = false;
  }
  return result;
};

io.on("connection", (socket) => {
  //KEEP TRACK OF ACTIVE USERS
  users++;
  console.log(`Currently ${users} active users`);

  //SAVE CURRENT LOBBY AND USER
  let currentLobby;
  let currentUser;

  //FUNCTION TO SEND UPDATE OF CURRENTLOBBY DATA
  const sendUpdate = () => {
    io.to(currentLobby.admin).emit("update", currentLobby);
  };

  //SENDS UPDATE EVERY 10SEC
  setInterval(() => {
    if (currentLobby) {
      sendUpdate();
    }
  }, 10000);

  socket.on("user", ({ userId, displayName }, callback) => {
    /* Checks if user is admin of any lobby */
    const userLobby = isValueInArrayOfObjects(lobbies, "admin", userId);
    if (userLobby) {
      /* Returns lobby that client is Admin of */
      callback(userLobby);
    }
  });

  socket.on("createLobby", ({ admin, lobbyName }, callback) => {
    /* Adds lobby to DB and returns it to client */
    const lobby = { admin, lobbyName, players: [], stage: 0 };
    lobbies.push(lobby);
    callback(lobby);
  });

  socket.on("login", ({ userId, displayName, lobby }, callback) => {
    /* Checks if lobby is in DB */
    const isLobbyInDb = isValueInArrayOfObjects(lobbies, "admin", lobby);
    if (isLobbyInDb) {
      /* Assign current lobby and user */
      currentLobby = isLobbyInDb[0];
      currentUser = userId;
      // Check if user was ever in this lobby and load his data.
      socket.join(currentLobby.admin);
      /* Adds player to lobby in db and sends update */
      currentLobby.players.push({
        userId,
        displayName,
        status: "Dołączył",
        score: 0,
      });
      sendUpdate();
      callback(currentLobby);
    }
  });

  socket.on("removePlayerFromLobby", (playerUid) => {
    if (currentLobby) {
      /* Checks if user is in lobby */
      const isUserInLobby = isValueInArrayOfObjects(
        currentLobby.players,
        "userId",
        playerUid
      );
      if (isUserInLobby) {
        /* Removes user from lobby in DB  */
        const indexOfUser = currentLobby.players.indexOf(isUserInLobby[0]);
        if (indexOfUser > -1) {
          currentLobby.players.splice(indexOfUser, 1);
        }
        sendUpdate();
      }
    }
    sendUpdate();
  });

  socket.on("startGame", () => {
    /* Increments stage of current lobby of 1 to start a game. */
    if (currentLobby) {
      currentLobby.stage++;
    }
    sendUpdate();
  });

  socket.on("sentencesReady", ({ playerUid, sentences, lie, isReady }) => {
    if (currentLobby) {
      /* Checks if user is in current lobby */
      const isUserInLobby = isValueInArrayOfObjects(
        currentLobby.players,
        "userId",
        playerUid
      );
      if (isUserInLobby) {
        /* Sets all values for choosing */
        userInLobby = isUserInLobby[0];
        userInLobby.status = isReady ? "Gotowy" : "Nie Gotowy";
        userInLobby.sentences = sentences;
        userInLobby.lie = lie;
      }
      /* Checks if all users are ready */
      const areAllReady = currentLobby.players.every(
        ({ status }) => status === "Gotowy"
      );
      if (areAllReady) {
        /* advences game stage by 1 and sets timer to sync to this date. */
        currentLobby.stage++;
        currentLobby.timer = Date.now();
        /* chooses next lier for the round */
        currentLobby.lier = currentLobby.players[currentLobby.round];
        /* Changes all players status to Wybiera as they are now choosing a lie */
        for (var player in currentLobby.players) {
          currentLobby.players[player].status = "Wybiera";
        }
      }
    }

    sendUpdate();
  });

  socket.on("choosen", ({ playerUid, index, isReady }) => {
    if (currentLobby) {
      /* checks if user is in lobby */
      const isUserInLobby = isValueInArrayOfObjects(
        currentLobby.players,
        "userId",
        playerUid
      );
      if (isUserInLobby) {
        /* sets status and checks if user is right */
        userInLobby = isUserInLobby[0];
        userInLobby.status = isReady ? "Gotowy" : "Wybiera";
        userInLobby.isHeRight = index === currentLobby.lier.lie;
      }
      /* Checks if all users are ready */
      const areAllReady = currentLobby.players.every(
        ({ status }) => status === "Gotowy"
      );
      if (areAllReady) {
        currentLobby.stage++;
        /* Changes all players status to choosing */
        for (var player in currentLobby.players) {
          currentLobby.players[player].status = "Wybiera";
        }
        /* Counts and sets scores for players. */
        for (var index in currentLobby.players) {
          let player = currentLobby.players[index];
          /* if player is lier */
          if (player.userId === currentLobby.lier.userId) {
            let count = 0;
            currentLobby.players.forEach((player) => {
              if (!player.isHeRight) count++;
            });
            count--;
            player.score += count;
            player.newScore = count;
          } else {
            /* If player isn't lier */
            if (player.isHeRight) {
              player.score += 1;
              player.newScore = 1;
            } else {
              player.newScore = 0;
            }
          }
        }
      }
    }
    sendUpdate();
  });

  socket.on("endGame", () => {
    /* if round is lower than amout of players in lobby */
    if (currentLobby.round < currentLobby.players.length - 1) {
      currentLobby.stage = 2;
      currentLobby.round++;
      currentLobby.timer = Date.now();
      currentLobby.lier = currentLobby.players[currentLobby.round];
    } else {
      currentLobby.stage = 0;
      currentLobby.round = 0;
    }
    sendUpdate();
  });

  socket.on("disconnect", () => {
    if (currentLobby && currentUser) {
      /* Checks if player is in lobby */
      const isUserInLobby = isValueInArrayOfObjects(
        currentLobby.players,
        "userId",
        currentUser
      );
      if (isUserInLobby) {
        /* Removes player from lobby */
        const indexOfUser = currentLobby.players.indexOf(isUserInLobby[0]);
        if (indexOfUser > -1) {
          currentLobby.players.splice(indexOfUser, 1);
        }
        /* If there are no more players in lobby ->  reset lobby */
        if (currentLobby.players.length === 0) {
          currentLobby.stage = 0;
          currentLobby.round = 0;
        }
        sendUpdate();
      }
    }

    /* Keep track of active users */
    users--;
    console.log(`Currently ${users} active users`);
  });
});

httpServer.listen(PORT, () =>
  console.log(`Server running on port: ${PORT} 🚀`)
);
