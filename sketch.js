let width = 0;
let height = 0;
let canvas = null;
let lastRuntimeError = null;

let player = null;
let player2 = null;
let multiplayerMode = true;
let lines = [];
let backgroundImage = null;


let creatingLines = false;

let idleImage = null;
let squatImage = null;
let jumpImage = null;
let oofImage = null;
let run1Image = null;
let run2Image = null;
let run3Image = null;
let fallenImage = null;
let fallImage = null;
let showingLines = false;
let showingCoins = false;
let levelImages = [];

let placingPlayer = false;
let placingCoins = false;
let playerPlaced = false;

let testingSinglePlayer = true;
let enableCheckpointMode = true; // when true, new populations start from the best reached level
// Auto-load last local save on startup? Keep disabled to avoid unexpectedly restoring saves.
let autoLoadLocalSaves = false;


let fallSound = null;
let jumpSound = null;
let bumpSound = null;
let landSound = null;

let snowImage = null;


let population = null;
let filePickerInput = null; // exposed file input so keyboard can open it
let levelDrawn = false;


let startingPlayerActions = 5;
let increaseActionsByAmount = 5;
let increaseActionsEveryXGenerations = 10;
let evolationSpeed = 1;
let maxUpdateTimePerFrameMs = 14; // ms budget per frame for updates (keeps rendering time for draw)


function preload() {
    backgroundImage = loadImage('images/levelImages/1.png')
    idleImage = loadImage('images/poses/idle.png')
    squatImage = loadImage('images/poses/squat.png')
    jumpImage = loadImage('images/poses/jump.png')
    oofImage = loadImage('images/poses/oof.png')
    run1Image = loadImage('images/poses/run1.png')
    run2Image = loadImage('images/poses/run2.png')
    run3Image = loadImage('images/poses/run3.png')
    fallenImage = loadImage('images/poses/fallen.png')
    fallImage = loadImage('images/poses/fall.png')


    snowImage = loadImage('images/snow3.png')

    for (let i = 1; i <= 43; i++) {
        levelImages.push(loadImage('images/levelImages/' + i + '.png'))
    }

    jumpSound = loadSound('sounds/jump.mp3')
    fallSound = loadSound('sounds/fall.mp3')
    bumpSound = loadSound('sounds/bump.mp3')
    landSound = loadSound('sounds/land.mp3')


}

// Global error handlers so runtime errors are visible on the canvas
window.addEventListener('error', (e) => {
    console.error('Runtime error caught:', e.error || e.message || e);
    lastRuntimeError = e.error || new Error(e.message || String(e));
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    lastRuntimeError = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
});


function setup() {
    setupCanvas();
    player = new Player();
    player2 = new Player();
    player2.currentPos = createVector(width / 2 + 100, height - 200);
    population = new Population(100);
    setupLevels();
    jumpSound.playMode('sustain');
    fallSound.playMode('sustain');
    bumpSound.playMode('sustain');
    landSound.playMode('sustain');
    
    loadMultiplayerProgress();
    setupFileDrop();
    // Attempt to auto-restore the last saved slot (if any) only when explicitly enabled
    if (autoLoadLocalSaves) tryLoadLastSlot();
    frameRate(60); // cap draw frames to 60fps target
}

function drawMousePosition() {
    let snappedX = mouseX - mouseX % 20;
    let snappedY = mouseY - mouseY % 20;
    push();


    fill(255, 0, 0)
    noStroke();
    ellipse(snappedX, snappedY, 5);

    if (mousePos1 != null) {
        stroke(255, 0, 0)
        strokeWeight(5)
        line(mousePos1.x, mousePos1.y, snappedX, snappedY)
    }

    pop();
}

let levelNumber = 0;

function draw() {
    // If a runtime error happened, show it on-screen so user can see the message
    if (lastRuntimeError) {
        background(30, 0, 0);
        fill(255, 200, 200);
        textSize(18);
        textAlign(CENTER, TOP);
        text('Runtime error: ' + (lastRuntimeError.message || String(lastRuntimeError)), width/2, 20);
        textSize(12);
        text('Open developer console for full stack trace. Reload to try again.', width/2, 60);
        return;
    }

    background(10);


    // if(frameCount % 5==0 ){
    //
    //     levelNumber  = (levelNumber +1)%43;
    // }
    // image(backgroundImage,0,0);
    // if (!creatingLines) {

    //     if (!placingPlayer || playerPlaced) {
    //
    //         player.Update();
    //         player.Show();
    //     }
    // } else {
    //     image(levelImages[levelNumber], 0, 0)
    // }
    push()
    translate(0, 50);
    if (testingSinglePlayer) {
        if (multiplayerMode) {
            drawMultiplayer();
        } else {
            image(levels[player.currentLevelNo].levelImage, 0, 0)
            levels[player.currentLevelNo].show();
            player.Update();
            player.Show();
        }
    } else if(replayingBestPlayer) {
        if(!cloneOfBestPlayer.hasFinishedInstructions){
            let startMs = millis();
            for (let i = 0; i < evolationSpeed; i++){
                cloneOfBestPlayer.Update();
                if (millis() - startMs > maxUpdateTimePerFrameMs) break;
            }

            showLevel(cloneOfBestPlayer.currentLevelNo);
            alreadyShowingSnow = false;
            cloneOfBestPlayer.Show();
        }else{
            replayingBestPlayer = false;
            mutePlayers = true;
        }

    }else{

        if (population.AllPlayersFinished()) {
            population.NaturalSelection();
            if (population.gen % increaseActionsEveryXGenerations === 0) {
                population.IncreasePlayerMoves(increaseActionsByAmount);
            }
        }
        let startMs = millis();
        for (let i = 0; i < evolationSpeed; i++){
            population.Update();
            if (millis() - startMs > maxUpdateTimePerFrameMs) break;
        }
        // population.Update()
        // population.Update()
        population.Show();

    }


    if (showingLines || creatingLines)
        showLines();

    if (creatingLines)
        drawMousePosition();


    if (frameCount % 15 === 0) {
        previousFrameRate = floor(getFrameRate())
    }


    pop();

    fill(0);
    noStroke();
    rect(0, 0, width, 50);
    if(!testingSinglePlayer){
        textSize(32);
        fill(255, 255, 255);
        text('FPS: ' + previousFrameRate, width - 160, 35);
        text('Gen: ' + population.gen, 30, 35);
        text('Moves: ' + population.players[0].brain.instructions.length, 200, 35);
        text('Best: ' + population.bestHeight, 400, 35);
        
        // Success HUD removed per user request; hide candidate success count
        // Checkpoint HUD removed per user request
        // Carry actions removed — always carry parent's action number when resuming at checkpoint
        // Removed checkpoint Level HUD to avoid overlaying FPS
        // Removed 'NEW CHECKPOINT REACHED' HUD overlay to avoid overlapping FPS
    }

    // Display download notification
    if (lastDownloadMessage && millis() - lastDownloadMessageTime < 3000) {
        fill(255, 255, 255);
        textSize(18);
        textAlign(LEFT);
        text(lastDownloadMessage, 30, 50 + 30);
    }

}

let previousFrameRate = 60;
let lastDownloadMessage = '';
let lastDownloadMessageTime = 0;

function showLevel(levelNumberToShow) {
    // print(levelNumberToShow)
    // image(levels[levelNumberToShow].levelImage, 0, 0)
    levels[levelNumberToShow].show();
}

function showLines() {
    if (creatingLines) {
        for (let l of lines) {
            l.Show();
        }
    } else {

        for (let l of levels[player.currentLevelNo].lines) {
            l.Show();
        }

    }

}


function setupCanvas() {
    canvas = createCanvas(1200, 950);
    canvas.parent('canvas');
    width = canvas.width;
    height = canvas.height - 50;
}

// Provide a simple drag-and-drop and file input to import a saved brain file
function setupFileDrop() {
    const div = document.getElementById('canvas');
    if (!div) return;

    // Prevent default browser behavior for dragover/drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
        div.addEventListener(evtName, function (e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    div.addEventListener('dragover', (e) => {
        e.dataTransfer.dropEffect = 'copy';
    });

    div.addEventListener('drop', async (e) => {
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        try {
            // Read file once to detect file type
            const text = await file.text();
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (err) {
                parsed = null;
            }
            
            // Check for multiplayer save first
            if (parsed && parsed.player1 && parsed.player2) {
                try {
                    player.currentPos = createVector(parsed.player1.x, parsed.player1.y);
                    player.currentLevelNo = parsed.player1.level;
                    player.bestLevelReached = parsed.player1.bestLevel || 0;
                    
                    player2.currentPos = createVector(parsed.player2.x, parsed.player2.y);
                    player2.currentLevelNo = parsed.player2.level;
                    player2.bestLevelReached = parsed.player2.bestLevel || 0;
                    
                    lastDownloadMessage = 'Multiplayer progress loaded! P1 Level: ' + player.currentLevelNo + ' P2 Level: ' + player2.currentLevelNo;
                    lastDownloadMessageTime = millis();
                    return;
                } catch (e) {
                    console.error('Error loading multiplayer file:', e);
                    lastDownloadMessage = 'Error loading multiplayer file';
                    lastDownloadMessageTime = millis();
                    return;
                }
            }
            
            // If snapshot, apply both brain and checkpoint from the snapshot (don't mutate)
            if (parsed && parsed.type === 'snapshot') {
                const loadedSnapshot = population.applySnapshotData(parsed);
                if (loadedSnapshot) {
                    lastDownloadMessage = 'Snapshot loaded! Level: ' + loadedSnapshot.level + ' Gen: ' + loadedSnapshot.generation;
                    lastDownloadMessageTime = millis();
                    return;
                }
            }
        } catch (e) {
            // ignore — we'll fall back to individual loaders below
        }
        // Try loading as Brain first, then fallback to checkpoint
        let loadedBrain = await Brain.loadBestBrainFromFile(file);
        if (loadedBrain && loadedBrain.brain) {
            try {
                for (let i = 0; i < population.players.length; i++) {
                    population.players[i].brain = loadedBrain.brain.clone();
                    // Don't mutate on first load - just use as-is
                }
                population.gen = loadedBrain.generation || population.gen;
                lastDownloadMessage = 'Brain loaded! Gen: ' + loadedBrain.generation;
                lastDownloadMessageTime = millis();
                return;
            } catch (e) {
                console.error('Error applying loaded brain:', e);
                lastDownloadMessage = 'Error loading brain file';
                lastDownloadMessageTime = millis();
                return;
            }
        }
        // Try checkpoint
        let loadedCheckpoint = await population.loadCheckpointFromFile(file);
        if (loadedCheckpoint) {
            for (let i = 0; i < population.players.length; i++) {
                population.players[i].playerStateAtStartOfBestLevel = population.checkpointState.clone();
                population.players[i].loadStartOfBestLevelPlayerState();
                if (population.checkpointState.brainActionNumber !== undefined) {
                    population.players[i].brain.currentInstructionNumber = population.checkpointState.brainActionNumber;
                }
            }
            lastDownloadMessage = 'Checkpoint loaded! Level: ' + loadedCheckpoint.level + ' Gen: ' + loadedCheckpoint.generation;
            lastDownloadMessageTime = millis();
            return;
        }
        lastDownloadMessage = 'Invalid file - not a brain, checkpoint, or snapshot';
        lastDownloadMessageTime = millis();
    });

    // Hidden input to fallback to manual file selection
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    filePickerInput = input; // expose the input globally
    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (err) {
                parsed = null;
            }
            
            // Check for multiplayer save first
            if (parsed && parsed.player1 && parsed.player2) {
                try {
                    player.currentPos = createVector(parsed.player1.x, parsed.player1.y);
                    player.currentLevelNo = parsed.player1.level;
                    player.bestLevelReached = parsed.player1.bestLevel || 0;
                    
                    player2.currentPos = createVector(parsed.player2.x, parsed.player2.y);
                    player2.currentLevelNo = parsed.player2.level;
                    player2.bestLevelReached = parsed.player2.bestLevel || 0;
                    
                    lastDownloadMessage = 'Multiplayer progress loaded! P1 Level: ' + player.currentLevelNo + ' P2 Level: ' + player2.currentLevelNo;
                    lastDownloadMessageTime = millis();
                    return;
                } catch (e) {
                    console.error('Error loading multiplayer file:', e);
                    lastDownloadMessage = 'Error loading multiplayer file';
                    lastDownloadMessageTime = millis();
                    return;
                }
            }
            
            if (parsed && parsed.type === 'snapshot') {
                const loadedSnapshot = population.applySnapshotData(parsed);
                if (loadedSnapshot) {
                    lastDownloadMessage = 'Snapshot loaded! Level: ' + loadedSnapshot.level + ' Gen: ' + loadedSnapshot.generation;
                    lastDownloadMessageTime = millis();
                    return;
                }
            }
        } catch (err) {
            // fallback to older handlers below
        }
        let loadedBrain = await Brain.loadBestBrainFromFile(file);
        if (loadedBrain && loadedBrain.brain) {
            try {
                for (let i = 0; i < population.players.length; i++) {
                    population.players[i].brain = loadedBrain.brain.clone();
                    // Don't mutate on first load - just use as-is
                }
                population.gen = loadedBrain.generation || population.gen;
                lastDownloadMessage = 'Brain loaded! Gen: ' + loadedBrain.generation;
                lastDownloadMessageTime = millis();
                return;
            } catch (e) {
                console.error('Error applying loaded brain:', e);
                lastDownloadMessage = 'Error loading brain file';
                lastDownloadMessageTime = millis();
                return;
            }
        }
        let loadedCheckpoint = await population.loadCheckpointFromFile(file);
        if (loadedCheckpoint) {
            for (let i = 0; i < population.players.length; i++) {
                population.players[i].playerStateAtStartOfBestLevel = population.checkpointState.clone();
                population.players[i].loadStartOfBestLevelPlayerState();
                if (population.checkpointState.brainActionNumber !== undefined) {
                    population.players[i].brain.currentInstructionNumber = population.checkpointState.brainActionNumber;
                }
            }
            lastDownloadMessage = 'Checkpoint loaded! Level: ' + loadedCheckpoint.level + ' Gen: ' + loadedCheckpoint.generation;
            lastDownloadMessageTime = millis();
            return;
        }
        lastDownloadMessage = 'Invalid file - not a brain, checkpoint, or snapshot';
        lastDownloadMessageTime = millis();
    });

    // small UI: click the canvas to pick a file
    div.addEventListener('dblclick', () => input.click());
}


function keyPressed() {
    switch (key) {
        case ' ':
            player.jumpHeld = true
            break;
        case 'S':
            bumpSound.stop();
            jumpSound.stop();
            landSound.stop();
            fallSound.stop();
            break;
        case 'w':
        case 'W':
            if (multiplayerMode) player2.jumpHeld = true;
            break;
        case 'a':
        case 'A':
            if (multiplayerMode) player2.leftHeld = true;
            break;
        case 'd':
        case 'D':
            if (multiplayerMode) player2.rightHeld = true;
            break;
        
    }

    switch (keyCode) {
        case LEFT_ARROW:
            player.leftHeld = true;
            break;
        case RIGHT_ARROW:
            player.rightHeld = true;
            break;
        case UP_ARROW:
            player.jumpHeld = true;
            break;
    }

}
replayingBestPlayer = false;
cloneOfBestPlayer = null;



function keyReleased() {

    switch (key) {
        case 'B':
            replayingBestPlayer = true;
            cloneOfBestPlayer = population.cloneOfBestPlayerFromPreviousGeneration.clone();
            evolationSpeed = 1;
            mutePlayers = false;
            break;
        case '1':
            // Download the best AI brain (PPO) as a JSON file
            try {
                let brainToSave = null;
                if (population && population.players && population.players.length > 0 && population.players[population.bestPlayerIndex]) {
                    brainToSave = population.players[population.bestPlayerIndex].brain;
                } else if (population && population.cloneOfBestPlayerFromPreviousGeneration) {
                    brainToSave = population.cloneOfBestPlayerFromPreviousGeneration.brain;
                }
                if (brainToSave) {
                    Brain.saveBestBrainToFile(brainToSave, population ? population.gen : 0);
                    lastDownloadMessage = 'Brain downloaded! Gen: ' + (population ? population.gen : 0);
                    lastDownloadMessageTime = millis();
                } else {
                    lastDownloadMessage = 'No brain available to download';
                    lastDownloadMessageTime = millis();
                }
            } catch (e) {
                console.error('Failed to download brain', e);
                lastDownloadMessage = 'Failed to download brain';
                lastDownloadMessageTime = millis();
            }
            break;
        case '2':
            // Open the hidden file picker to import a brain/checkpoint/snapshot
            if (filePickerInput) {
                filePickerInput.value = null;
                filePickerInput.click();
            } else {
                alert('File picker not available');
            }
            break;
        case '3':
            // Save snapshot/multiplayer depending on mode
            if (testingSinglePlayer && multiplayerMode) {
                // In multiplayer mode - save multiplayer progress
                saveMultiplayerProgressManual();
            } else {
                // In AI mode - save AI snapshot to slot 3
                saveToLocalSlot(3);
            }
            break;
        case '!':
            // Shift+1 -> load slot 1
            loadFromLocalSlot(1);
            break;
        case '@':
            // Shift+2 -> load slot 2
            loadFromLocalSlot(2);
            break;
        case '#':
            // Shift+3 -> load slot 3
            loadFromLocalSlot(3);
            break;
        case '4':
            // Save multiplayer progress
            if (testingSinglePlayer && multiplayerMode) {
                saveMultiplayerProgressManual();
            }
            break;
        case '5':
            // Load multiplayer progress
            if (testingSinglePlayer && multiplayerMode) {
                loadMultiplayerProgressManual();
            }
            break;
        case 'P':
            // Toggle checkpoint progression on/off
            enableCheckpointMode = !enableCheckpointMode;
            alert('Checkpoint progression: ' + (enableCheckpointMode ? 'ON' : 'OFF'));
            break;
        case 'L':
            // Toggle auto snapshot saving on new level
            window.autoSaveSnapshotsOnNewLevel = !window.autoSaveSnapshotsOnNewLevel;
            alert('Auto snapshot on new level: ' + (window.autoSaveSnapshotsOnNewLevel ? 'ON' : 'OFF'));
            break;
        // 'O' removed — carry actions always enabled
        case 'K':
            // K key intentionally does nothing now — reserved for future UI features
            break;
        case ' ':
            if (!creatingLines) {
                player.jumpHeld = false
                player.Jump()
            }
            break;
        case 'w':
        case 'W':
            if (multiplayerMode) {
                player2.jumpHeld = false;
                player2.Jump();
            }
            break;
        case 'a':
        case 'A':
            if (multiplayerMode) player2.leftHeld = false;
            break;
        case 'd':
        case 'D':
            if (multiplayerMode) player2.rightHeld = false;
            break;
        case 'N':
            if (creatingLines) {
                levelNumber += 1;
                linesString += '\nlevels.push(tempLevel);';
                linesString += '\ntempLevel = new Level();';
                print(linesString);
                lines = [];
                linesString = '';
                mousePos1 = null;
                mousePos2 = null;
            } else {
                player.currentLevelNo += 1;
                print(player.currentLevelNo);
            }
            break;
    }

    switch (keyCode) {
        case LEFT_ARROW:
            player.leftHeld = false;
            break;
        case RIGHT_ARROW:
            player.rightHeld = false;
            break;
        case UP_ARROW:
            if (!creatingLines) {
                player.jumpHeld = false;
                player.Jump();
            }
            break;
    }
    
    if (key === '-' || key === '_' || key === '[') {
        evolationSpeed = constrain(evolationSpeed - 1, 1, 50);
        print("Speed:", evolationSpeed);
    }
    if (key === '=' || key === '+' || key === ']') {
        evolationSpeed = constrain(evolationSpeed + 1, 1, 50);
        print("Speed:", evolationSpeed);
    }
    if (key === '0') {
        evolationSpeed = 1;
        print("Speed reset:", evolationSpeed);
    }
    if (key === '9') {
        evolationSpeed = 10;
        print("Speed set to 10:", evolationSpeed);
    }
    if (key === '8') {
        evolationSpeed = 50;
        print("Speed set to max:", evolationSpeed);
    }
}


let mousePos1 = null;
let mousePos2 = null;
let linesString = "";


function mouseClicked() {
    if (creatingLines) {
        let snappedX = mouseX - mouseX % 20;
        let snappedY = mouseY - mouseY % 20;
        if (mousePos1 == null) {
            mousePos1 = createVector(snappedX, snappedY);
        } else {
            mousePos2 = createVector(snappedX, snappedY);
            // print('tempLevel.lines.push(new Line(' + mousePos1.x + ',' + mousePos1.y + ',' + mousePos2.x + ',' + mousePos2.y + '));');
            lines.push(new Line(mousePos1.x, mousePos1.y, mousePos2.x, mousePos2.y));
            linesString += '\ntempLevel.lines.push(new Line(' + mousePos1.x + ',' + mousePos1.y + ',' + mousePos2.x + ',' + mousePos2.y + '));';
            mousePos1 = null;
            mousePos2 = null;
        }
    } else if (placingPlayer && !playerPlaced) {
        playerPlaced = true;
        player.currentPos = createVector(mouseX, mouseY);


    } else if (placingCoins) {


    }
    print("levels[" + player.currentLevelNo + "].coins.push(new Coin( " + floor(mouseX) + "," + floor(mouseY - 50) + ' , "progress" ));');
}

// Save current snapshot (checkpoint + brain) to a numbered localStorage slot
function saveToLocalSlot(slotNumber) {
    if (!population) return;
    // ensure checkpoint exists
    if (!population.checkpointState) {
        if (population.cloneOfBestPlayerFromPreviousGeneration && population.cloneOfBestPlayerFromPreviousGeneration.playerStateAtStartOfBestLevel) {
            population.checkpointState = population.cloneOfBestPlayerFromPreviousGeneration.playerStateAtStartOfBestLevel.clone();
            population.currentBestLevelReached = population.cloneOfBestPlayerFromPreviousGeneration.bestLevelReached || population.currentBestLevelReached;
        } else if (population.players && population.players[population.bestPlayerIndex] && population.players[population.bestPlayerIndex].playerStateAtStartOfBestLevel) {
            population.checkpointState = population.players[population.bestPlayerIndex].playerStateAtStartOfBestLevel.clone();
            population.currentBestLevelReached = population.players[population.bestPlayerIndex].bestLevelReached || population.currentBestLevelReached;
        } else if (population.players && population.players.length > 0) {
            let p = population.players[population.bestPlayerIndex] || population.players[0];
            let tempState = new PlayerState();
            tempState.getStateFromPlayer(p);
            population.checkpointState = tempState;
            population.currentBestLevelReached = tempState.bestLevelReached || population.currentBestLevelReached;
        }
    }

    // choose brain to save
    let brainToSave = null;
    if (population.players && population.players.length > 0 && population.players[population.bestPlayerIndex]) {
        brainToSave = population.players[population.bestPlayerIndex].brain;
    } else if (population.cloneOfBestPlayerFromPreviousGeneration) {
        brainToSave = population.cloneOfBestPlayerFromPreviousGeneration.brain;
    }

    const obj = {
        type: 'snapshot',
        generation: population.gen,
        level: population.currentBestLevelReached,
        checkpoint: population.checkpointState ? population.checkpointState.toJSON() : null,
        brain: brainToSave ? brainToSave.toJSON() : null,
        savedAt: new Date().toISOString()
    };

    try {
        localStorage.setItem('jumpking_slot' + slotNumber, JSON.stringify(obj));
        localStorage.setItem('jumpking_last_slot', slotNumber.toString());
        // also create a downloadable file as backup
        const json = JSON.stringify(obj, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        let filename;
        if (slotNumber === 3) {
            filename = 'jumpking_snapshot_gen_' + population.gen + '_level_' + (population.currentBestLevelReached || 0) + '.json';
        } else {
            filename = 'jumpking_slot' + slotNumber + '_gen_' + population.gen + '.json';
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        lastDownloadMessage = 'Saved to slot ' + slotNumber + ' (Generation: ' + population.gen + ')';
        lastDownloadMessageTime = millis();
    } catch (e) {
        console.error('Failed to save to local slot', e);
        lastDownloadMessage = 'Failed to save to slot ' + slotNumber;
        lastDownloadMessageTime = millis();
    }
}

// Load snapshot from a numbered localStorage slot
async function loadFromLocalSlot(slotNumber) {
    try {
        const str = localStorage.getItem('jumpking_slot' + slotNumber);
        if (!str) { 
            lastDownloadMessage = 'No save in slot ' + slotNumber;
            lastDownloadMessageTime = millis();
            return; 
        }
        const data = JSON.parse(str);
        const applied = population.applySnapshotData(data);
        if (applied) {
            lastDownloadMessage = 'Loaded slot ' + slotNumber + ' Level: ' + applied.level + ' Gen: ' + applied.generation;
            lastDownloadMessageTime = millis();
        } else {
            lastDownloadMessage = 'Failed to apply slot ' + slotNumber;
            lastDownloadMessageTime = millis();
        }
    } catch (e) {
        console.error('Failed to load slot', e);
        lastDownloadMessage = 'Failed to load slot ' + slotNumber;
        lastDownloadMessageTime = millis();
    }
}

// Try to auto-load the last saved slot on startup
function tryLoadLastSlot() {
    try {
        const last = localStorage.getItem('jumpking_last_slot');
        if (!last) return;
        const num = parseInt(last);
        if (!isNaN(num)) {
            const str = localStorage.getItem('jumpking_slot' + num);
            if (str) {
                const data = JSON.parse(str);
                population.applySnapshotData(data);
                console.log('Auto-loaded slot ' + num);
            }
        }
    } catch (e) { console.error('Auto-load failed', e); }
}

//todo
// things to do
// - when a player lands in a new level, record the game state and start the next evolution at that point DONE
// - when a player falls into a previous level, end the players movements, and mutate that move which fucked them up with a 100% chance
// fix landing logic so it checks below maybe, or it checks after all the corrections are done that there is still something below it. actually lets do that now. i dont knwo why im still typing this


// - add a player replay, we could also include a generation replay, thats probably it
// - maybe consider adding a goal system for really hard levels.

function drawMultiplayer() {
    player.Update();
    player2.Update();
    
    let sameLevel = player.currentLevelNo === player2.currentLevelNo;
    
    if (sameLevel) {
        image(levels[player.currentLevelNo].levelImage, 0, 0);
        levels[player.currentLevelNo].show();
        player.ShowMultiplayer(1);
        player2.ShowMultiplayer(2);
    } else {
        let splitHeight = height / 2;
        
        // Player 1's view (top half) - follows player vertically
        push();
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.rect(0, 0, width, splitHeight);
        drawingContext.clip();
        let p1offsetY = player.currentPos.y - splitHeight / 2;
        p1offsetY = constrain(p1offsetY, 0, height - splitHeight);
        translate(0, -p1offsetY);
        image(levels[player.currentLevelNo].levelImage, 0, 0);
        levels[player.currentLevelNo].show();
        player.ShowMultiplayer(1);
        drawingContext.restore();
        pop();
        
        // Player 2's view (bottom half) - follows player vertically
        push();
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.rect(0, splitHeight, width, splitHeight);
        drawingContext.clip();
        let p2offsetY = player2.currentPos.y - splitHeight / 2;
        p2offsetY = constrain(p2offsetY, 0, height - splitHeight);
        translate(0, splitHeight - p2offsetY);
        image(levels[player2.currentLevelNo].levelImage, 0, 0);
        levels[player2.currentLevelNo].show();
        player2.ShowMultiplayer(2);
        drawingContext.restore();
        pop();
        
        // Divider line
        stroke(255);
        strokeWeight(4);
        line(0, splitHeight, width, splitHeight);
    }
    
    if (frameCount % 300 === 0) {
        saveMultiplayerProgress();
    }
}

function saveMultiplayerProgress() {
    let data = {
        player1: {
            x: player.currentPos.x,
            y: player.currentPos.y,
            level: player.currentLevelNo,
            bestLevel: player.bestLevelReached
        },
        player2: {
            x: player2.currentPos.x,
            y: player2.currentPos.y,
            level: player2.currentLevelNo,
            bestLevel: player2.bestLevelReached
        },
        savedAt: new Date().toISOString()
    };
    localStorage.setItem('jumpKingMultiplayer', JSON.stringify(data));
    console.log('Progress saved!');
}

function loadMultiplayerProgress() {
    let saved = localStorage.getItem('jumpKingMultiplayer');
    if (saved && multiplayerMode && testingSinglePlayer) {
        let data = JSON.parse(saved);
        player.currentPos = createVector(data.player1.x, data.player1.y);
        player.currentLevelNo = data.player1.level;
        player.bestLevelReached = data.player1.bestLevel || 0;
        
        player2.currentPos = createVector(data.player2.x, data.player2.y);
        player2.currentLevelNo = data.player2.level;
        player2.bestLevelReached = data.player2.bestLevel || 0;
        console.log('Progress loaded!');
    }
}

// Manual save for multiplayer (button 4)
function saveMultiplayerProgressManual() {
    let data = {
        player1: {
            x: player.currentPos.x,
            y: player.currentPos.y,
            level: player.currentLevelNo,
            bestLevel: player.bestLevelReached
        },
        player2: {
            x: player2.currentPos.x,
            y: player2.currentPos.y,
            level: player2.currentLevelNo,
            bestLevel: player2.bestLevelReached
        },
        savedAt: new Date().toISOString()
    };
    
    try {
        localStorage.setItem('jumpKingMultiplayer', JSON.stringify(data));
        
        // Also create a downloadable backup file
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = 'jumpking_multiplayer_' + timestamp + '.json';
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
        lastDownloadMessage = 'Multiplayer progress saved! P1 Level: ' + player.currentLevelNo + ' P2 Level: ' + player2.currentLevelNo;
        lastDownloadMessageTime = millis();
        console.log('Multiplayer progress saved: ' + filename);
    } catch (e) {
        console.error('Failed to save multiplayer progress', e);
        lastDownloadMessage = 'Failed to save multiplayer progress';
        lastDownloadMessageTime = millis();
    }
}

// Manual load for multiplayer (button 5)
function loadMultiplayerProgressManual() {
    try {
        let saved = localStorage.getItem('jumpKingMultiplayer');
        if (!saved) {
            lastDownloadMessage = 'No multiplayer save found';
            lastDownloadMessageTime = millis();
            return;
        }
        
        let data = JSON.parse(saved);
        player.currentPos = createVector(data.player1.x, data.player1.y);
        player.currentLevelNo = data.player1.level;
        player.bestLevelReached = data.player1.bestLevel || 0;
        
        player2.currentPos = createVector(data.player2.x, data.player2.y);
        player2.currentLevelNo = data.player2.level;
        player2.bestLevelReached = data.player2.bestLevel || 0;
        
        lastDownloadMessage = 'Multiplayer progress loaded! P1 Level: ' + player.currentLevelNo + ' P2 Level: ' + player2.currentLevelNo;
        lastDownloadMessageTime = millis();
        console.log('Multiplayer progress loaded!');
    } catch (e) {
        console.error('Failed to load multiplayer progress', e);
        lastDownloadMessage = 'Failed to load multiplayer progress';
        lastDownloadMessageTime = millis();
    }
}
