let alreadyShowingSnow = false;



class Population {

    constructor(size) {
        this.popSize = size;
        this.players = [];
        for (let i = 0; i < size; i++) {
            this.players.push(new Player());
        }

        this.showingFail = false;
        this.failPlayerNo = 0;
        this.bestPlayerIndex = 0;
        this.currentHighestPlayerIndex = 0;
        this.fitnessSum = 0;
        this.gen = 1;
        this.bestHeight = 0;
        this.showingLevelNo = 0;
        this.currentBestLevelReached = 0;
        this.purgeTheSlackers = false;
        this.reachedBestLevelAtActionNo = 0;
        this.newLevelReached = false;
        this.cloneOfBestPlayerFromPreviousGeneration = this.players[0].clone();
        this.checkpointState = null; // PlayerState snapshot for the current best level checkpoint
        // No local persistence for checkpoints; file-based only
        this.requiredSuccessfulPlayersForLevel = 5; // require this many players to reach a level before it's unlocked
        this.latestCandidateSuccessCount = 0; // last generation's candidate success count
    }

    Update() {
        for (let i = 0; i < this.players.length; i++) {
            this.players[i].Update();
            // if(this.players[i].currentLevelNo >0 && !this.showingFail ){
            //     this.showingFail= true;
            //     this.failPlayerNo = i;
            //     this.ResetAllPlayers()
            // }
        }

    }

    SetBestPlayer() {

        this.bestPlayerIndex = 0;
        this.newLevelReached = false;
        // Reset candidate success count for this generation; we'll recompute if there's a candidate
        this.latestCandidateSuccessCount = 0;
        for (let i = 0; i < this.players.length; i++) {
            if (this.players[i].bestHeightReached > this.players[this.bestPlayerIndex].bestHeightReached) {
                this.bestPlayerIndex = i;
            }
        }

        if (this.players[this.bestPlayerIndex].bestLevelReached > this.currentBestLevelReached) {
            let candidateLevel = this.players[this.bestPlayerIndex].bestLevelReached;
            // Count how many players have reached this candidate level
            let count = 0;
            for (let i = 0; i < this.players.length; i++) {
                if (this.players[i].bestLevelReached >= candidateLevel) count++;
            }
            this.latestCandidateSuccessCount = count;
            // Only unlock the candidate level if at least requiredSuccessfulPlayersForLevel players did it
            if (count >= this.requiredSuccessfulPlayersForLevel) {
                this.currentBestLevelReached = candidateLevel;
                this.newLevelReached = true;
                this.reachedBestLevelAtActionNo = this.players[this.bestPlayerIndex].bestLevelReachedOnActionNo;
                print("NEW LEVEL, action number", this.reachedBestLevelAtActionNo)
                console.log('Checkpoint saved: level ' + this.currentBestLevelReached + ' at action ' + this.reachedBestLevelAtActionNo + ' (count=' + count + ')');
                // Save a checkpoint state from the player's saved start-of-best-level state (if present)
                if (this.players[this.bestPlayerIndex].playerStateAtStartOfBestLevel) {
                    this.checkpointState = this.players[this.bestPlayerIndex].playerStateAtStartOfBestLevel.clone();
                } else {
                    // Fallback: capture current player state
                    let tempState = new PlayerState();
                    tempState.getStateFromPlayer(this.players[this.bestPlayerIndex]);
                    this.checkpointState = tempState;
                }
                // No local persistence for checkpoints; file-based only
                // Auto-save snapshot when a new level is reached if configured
                if (typeof autoSaveSnapshotsOnNewLevel !== 'undefined' && autoSaveSnapshotsOnNewLevel) {
                    this.saveSnapshotToFile();
                }
            } else {
                // Not enough players yet — candidate not unlocked (but track count)
                console.log('Candidate level ' + candidateLevel + ' reached by ' + count + ' players; need ' + this.requiredSuccessfulPlayersForLevel);
            }
        }
        this.bestHeight = this.players[this.bestPlayerIndex].bestHeightReached;
    }

    SetCurrentHighestPlayer() {
        this.currentHighestPlayerIndex = 0;
        for (let i = 0; i < this.players.length; i++) {
            if (this.players[i].GetGlobalHeight() > this.players[this.currentHighestPlayerIndex].GetGlobalHeight()) {
                this.currentHighestPlayerIndex = i;
            }
        }
    }

    Show() {

        this.SetCurrentHighestPlayer()
        let highestPlayer = this.players[this.currentHighestPlayerIndex];
        let highestLevelNo = this.players[this.currentHighestPlayerIndex].currentLevelNo;

        if(highestPlayer.currentLevelNo > highestPlayer.bestLevelReached && !highestPlayer.progressionCoinPickedUp){
            highestLevelNo -=1;
        }
        showLevel(highestLevelNo);
        alreadyShowingSnow = false;
        this.showingLevelNo = highestLevelNo;
        for (let i = 0; i < this.players.length; i++) {
            if (this.players[i].currentLevelNo >= highestLevelNo - 1 && this.players[i].currentLevelNo <=highestLevelNo ) {
                this.players[i].Show();
            }
        }

        // this.ShowPopulationInfo();

    }


    ResetAllPlayers() {
        for (let i = 0; i < this.players.length; i++) {
            this.players[i].ResetPlayer();
        }
    }

    IncreasePlayerMoves(increaseBy) {
        for (let i = 0; i < this.players.length; i++) {
            this.players[i].brain.increaseMoves(increaseBy);
        }
    }

    AllPlayersFinished() {
        for (let i = 0; i < this.players.length; i++) {
            if (!this.players[i].hasFinishedInstructions) {
                return false;
            }
        }
        return true;
    }

    NaturalSelection() {
        console.log('NaturalSelection called; gen=', this.gen, 'bestPlayerIndex=', this.bestPlayerIndex);
        // PPO branch: if brains are PPO-compatible then perform a PPO-style
        // training step instead of a genetic reproduction step.
        this.SetBestPlayer();
        this.CalculateFitnessSum();
        this.cloneOfBestPlayerFromPreviousGeneration = this.players[this.bestPlayerIndex].clone();

        // If first player's brain indicates PPO, run a simpler PPO training flow
        if (this.players.length > 0 && this.players[0].brain && this.players[0].brain.type === 'PPO') {
            // Aggregate buffers from all players and compute GAE (discounted returns + lambda)
            const gamma = 0.99;
            const lambda = 0.95;
            let aggregated = [];
            for (let i = 0; i < this.players.length; i++) {
                let p = this.players[i];
                try { p.CalculateFitness(); } catch (e) {}
                const finalReward = p.fitness || 0;
                if (!(p.brain && p.brain.buffer && p.brain.buffer.length > 0)) {
                    if (p.brain) p.brain.buffer = [];
                    continue;
                }

                const buf = p.brain.buffer;
                const n = buf.length;
                // build arrays of baseFitness and values
                const values = buf.map(b => b.value || 0);
                const baseHeights = buf.map(b => b.baseHeight || 0);
                const baseLevels = buf.map(b => b.baseLevel || 0);
                const baseCoins = buf.map(b => b.baseCoins || 0);

                // Reward shaping constants (tunable)
                const heightScale = 1.0; // reward per unit height
                const coinReward = 500000; // keep parity with Player.CalculateFitness coin value
                const levelBonus = 1000000; // big bonus for reaching a new level
                const timePenalty = -0.01; // small per-step penalty to encourage efficiency

                // compute per-step rewards using delta of squared "heightThisLevel" to match Player.CalculateFitness
                // heightThisLevel = bestHeightReached - (height * bestLevelReached)
                const rewards = new Array(n).fill(0);
                for (let t = 0; t < n - 1; t++) {
                    const h0 = (baseHeights[t] || 0) - (baseLevels[t] || 0) * height;
                    const h1 = (baseHeights[t + 1] || 0) - (baseLevels[t + 1] || 0) * height;
                    const fitnessDeltaFromHeight = (h1 * h1) - (h0 * h0);
                    const dcoins = (baseCoins[t + 1] || 0) - (baseCoins[t] || 0);
                    const dlevel = (baseLevels[t + 1] || 0) - (baseLevels[t] || 0);
                    let r = fitnessDeltaFromHeight;
                    if (dcoins > 0) r += dcoins * coinReward;
                    if (dlevel > 0) r += dlevel * levelBonus;
                    r += timePenalty;
                    rewards[t] = r;
                }
                // last step: compare against final player state
                const hLast = (baseHeights[n - 1] || 0) - (baseLevels[n - 1] || 0) * height;
                const hFinal = (p.bestHeightReached || 0) - (p.bestLevelReached || 0) * height;
                const lastFitnessDeltaFromHeight = (hFinal * hFinal) - (hLast * hLast);
                const lastDcoins = (p.numberOfCoinsPickedUp || 0) - (baseCoins[n - 1] || 0);
                const lastDlevel = (p.bestLevelReached || 0) - (baseLevels[n - 1] || 0);
                let lastR = lastFitnessDeltaFromHeight;
                if (lastDcoins > 0) lastR += lastDcoins * coinReward;
                if (lastDlevel > 0) lastR += lastDlevel * levelBonus;
                lastR += timePenalty;
                rewards[n - 1] = lastR;

                // compute deltas and advantages (GAE)
                const deltas = new Array(n).fill(0);
                for (let t = 0; t < n; t++) {
                    const v = values[t] || 0;
                    const vNext = (t + 1 < n) ? (values[t + 1] || 0) : 0;
                    deltas[t] = rewards[t] + gamma * vNext - v;
                }
                const advs = new Array(n).fill(0);
                let lastAdv = 0;
                for (let t = n - 1; t >= 0; t--) {
                    lastAdv = deltas[t] + gamma * lambda * lastAdv;
                    advs[t] = lastAdv;
                }

                // returns = advantages + values
                for (let t = 0; t < n; t++) {
                    aggregated.push({
                        obs: buf[t].obs,
                        action: buf[t].action,
                        logp: buf[t].logp,
                        value: buf[t].value,
                        return: advs[t] + (values[t] || 0),
                        adv: advs[t]
                    });
                }

                // clear buffer
                p.brain.buffer = [];
            }

            // train using the best player's brain as the trainer (in-place update)
            const trainerBrain = this.players[this.bestPlayerIndex].brain;
            try {
                // Immediately reset all players and give them a copy of the current trainer brain
                for (let i = 0; i < this.players.length; i++) {
                    try {
                        this.players[i].brain = trainerBrain.clone();
                    } catch (e) {
                        // fallback: leave existing brain
                    }
                    this.players[i].ResetPlayer();
                    if (this.checkpointState) {
                        this.players[i].playerStateAtStartOfBestLevel = this.checkpointState.clone();
                        this.players[i].loadStartOfBestLevelPlayerState();
                        if (this.checkpointState.brainActionNumber !== undefined) {
                            this.players[i].brain.currentInstructionNumber = this.checkpointState.brainActionNumber;
                        }
                    }
                }

                // Start async training; when it finishes copy updated weights into each player's models
                trainerBrain.trainOnAggregatedBuffer(aggregated, { epochs: 5, batchSize: 64, clipRatio: 0.2, policyLr: 2e-4, valueLr: 1e-3, entropyCoef: 1e-3, gamma: 0.99, lambda: 0.95 }).then(() => {
                    for (let i = 0; i < this.players.length; i++) {
                        try {
                            if (typeof copyModelWeights === 'function' && trainerBrain.policyModel && this.players[i].brain && this.players[i].brain.policyModel) {
                                copyModelWeights(trainerBrain.policyModel, this.players[i].brain.policyModel);
                            }
                            if (typeof copyModelWeights === 'function' && trainerBrain.valueModel && this.players[i].brain && this.players[i].brain.valueModel) {
                                copyModelWeights(trainerBrain.valueModel, this.players[i].brain.valueModel);
                            }
                        } catch (e) {
                            // ignore individual copy errors
                        }
                    }
                    console.log('PPO training complete; weights updated for generation', this.gen);
                }).catch(e => console.error('PPO training failed', e));
            } catch (e) {
                console.error('PPO training error', e);
            }
            // Generation completed — apply scheduled move increases at gen boundaries (original behaviour)
            if (this.gen % 10 === 0) {
                // every 10 generations increase available moves by 5
                this.IncreasePlayerMoves(5);
                console.log('Increased player moves by 5 at generation', this.gen);
                try {
                    if (this.players && this.players[0] && this.players[0].brain && this.players[0].brain.instructions) {
                        console.log('First player brain instructions length now', this.players[0].brain.instructions.length);
                    }
                } catch (e) {}
            }
            this.gen++;
            this.newLevelReached = false;
            return;
        }

        // --- Original GA-style reproduction flow for non-PPO brains ---
        let nextGen = [];

        // Choose checkpoint state if available and checkpoint mode enabled.
        // Apply the checkpoint if it exists at all; also fallback to cloneOfBestPlayer when a new level was just reached.
        let bestStartState = null;
        if (typeof enableCheckpointMode !== 'undefined' && enableCheckpointMode && this.currentBestLevelReached !== 0) {
            if (this.checkpointState) {
                bestStartState = this.checkpointState.clone();
            } else if (this.newLevelReached && this.cloneOfBestPlayerFromPreviousGeneration && this.cloneOfBestPlayerFromPreviousGeneration.playerStateAtStartOfBestLevel) {
                bestStartState = this.cloneOfBestPlayerFromPreviousGeneration.playerStateAtStartOfBestLevel.clone();
            }
        }

        nextGen.push(this.players[this.bestPlayerIndex].clone());
        for (let i = 1; i < this.players.length; i++) {
            let parent = this.SelectParent();
            let baby = parent.clone()
            // if the parent fell to the previous level then mutate the baby at the action that caused them to fall
            if(parent.fellToPreviousLevel){
                baby.brain.mutateActionNumber(parent.fellOnActionNo);
            }
            baby.brain.mutate();
            nextGen.push(baby);
        }

        this.players = [];
        for (let i = 0; i < nextGen.length; i++) {
            this.players[i] = nextGen[i];
            // Reset the player's runtime state so they start fresh (match original GA behaviour)
            try { this.players[i].ResetPlayer(); } catch (e) {}
            // If checkpoint mode is on and we captured a best start state, set it for every player
            if (bestStartState) {
                this.players[i].playerStateAtStartOfBestLevel = bestStartState.clone();
                this.players[i].loadStartOfBestLevelPlayerState();
                // Always carry the parent's action number when resuming at a checkpoint
                if (bestStartState.brainActionNumber !== undefined) {
                    this.players[i].brain.currentInstructionNumber = bestStartState.brainActionNumber;
                }
            }
        }

        // Generation completed — apply scheduled move increases at gen boundaries (original behaviour)
        if (this.gen % 10 === 0) {
            this.IncreasePlayerMoves(5);
            console.log('Increased player moves by 5 at generation', this.gen);
            try {
                if (this.players && this.players[0] && this.players[0].brain && this.players[0].brain.instructions) {
                    console.log('First player brain instructions length now', this.players[0].brain.instructions.length);
                }
            } catch (e) {}
        }
        this.gen++;
        if (bestStartState) {
            console.log('Applied checkpoint to next generation, level: ' + this.currentBestLevelReached);
        }
        // Reset new level flag to stop flashing the HUD next frame
        this.newLevelReached = false;
    }

    // Removed localStorage-based checkpoint persistence; file-based only

    // Save checkpoint state to downloadable file
    saveCheckpointToFile() {
        if (!this.checkpointState) return;
        try {
            const obj = {
                type: 'checkpoint',
                generation: this.gen,
                level: this.currentBestLevelReached,
                checkpoint: this.checkpointState.toJSON(),
                savedAt: new Date().toISOString()
            };
            const json = JSON.stringify(obj, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const filename = 'jumpking_checkpoint_gen_' + this.gen + '_level_' + this.currentBestLevelReached + '.json';
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            console.log('Checkpoint file created: ' + filename);
        } catch (e) {
            console.error('Failed to save checkpoint to file', e);
        }
    }

    // Save a snapshot containing both the brain and checkpoint to a downloadable file
    saveSnapshotToFile() {
        if (!this.checkpointState) return;
        try {
            // Choose a brain to save: use the best player's brain if available, otherwise the clone
            let brainToSave = null;
            if (this.players && this.players.length > 0 && this.players[this.bestPlayerIndex]) {
                brainToSave = this.players[this.bestPlayerIndex].brain;
            } else if (this.cloneOfBestPlayerFromPreviousGeneration) {
                brainToSave = this.cloneOfBestPlayerFromPreviousGeneration.brain;
            }
            const obj = {
                type: 'snapshot',
                generation: this.gen,
                level: this.currentBestLevelReached,
                checkpoint: this.checkpointState.toJSON(),
                brain: brainToSave ? brainToSave.toJSON() : null,
                savedAt: new Date().toISOString()
            };
            const json = JSON.stringify(obj, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const filename = 'jumpking_snapshot_gen_' + this.gen + '_level_' + this.currentBestLevelReached + '.json';
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            console.log('Snapshot file created: ' + filename);
        } catch (e) {
            console.error('Failed to save snapshot to file', e);
        }
    }

    // Load a checkpoint file and apply to population
    async loadCheckpointFromFile(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data || data.type !== 'checkpoint' || !data.checkpoint) return null;
            this.checkpointState = PlayerState.fromJSON(data.checkpoint);
            if (this.checkpointState && this.checkpointState.bestLevelReached) {
                this.currentBestLevelReached = this.checkpointState.bestLevelReached;
            }
            // no local save
            console.log('Checkpoint loaded from file: level ' + this.currentBestLevelReached);
            return { generation: data.generation || 0, level: data.level || this.currentBestLevelReached };
        } catch (e) {
            console.error('Failed to parse checkpoint file', e);
            return null;
        }
    }

    // Apply snapshot data (object parsed from disk) and set population state
    applySnapshotData(data) {
        if (!data || data.type !== 'snapshot') return null;
        try {
            if (data.checkpoint) {
                this.checkpointState = PlayerState.fromJSON(data.checkpoint);
                if (this.checkpointState && this.checkpointState.bestLevelReached) {
                    this.currentBestLevelReached = this.checkpointState.bestLevelReached;
                }
            }
            if (data.generation !== undefined) {
                this.gen = data.generation;
            }
            // If a brain is present in the snapshot, apply it to all players
            if (data.brain) {
                const loadedBrain = Brain.fromJSON(data.brain);
                for (let i = 0; i < this.players.length; i++) {
                    this.players[i].brain = loadedBrain.clone();
                }
                // Keep a clone of the best as the basis for future generations
                this.cloneOfBestPlayerFromPreviousGeneration = this.players[this.bestPlayerIndex] ? this.players[this.bestPlayerIndex].clone() : this.players[0].clone();
            }
            // If we have a checkpoint state, ensure each player's start-of-best-level player state is loaded
            if (this.checkpointState) {
                for (let i = 0; i < this.players.length; i++) {
                    this.players[i].playerStateAtStartOfBestLevel = this.checkpointState.clone();
                    this.players[i].loadStartOfBestLevelPlayerState();
                    if (this.checkpointState.brainActionNumber !== undefined) {
                        this.players[i].brain.currentInstructionNumber = this.checkpointState.brainActionNumber;
                    }
                    // Reset run state so they can start using the loaded snapshot
                    this.players[i].hasFinishedInstructions = false;
                    this.players[i].playersDead = false;
                    this.players[i].currentPos = this.players[i].currentPos || createVector(width / 2, height - 200);
                }
            }
            console.log('Snapshot applied: level ' + this.currentBestLevelReached + ' generation ' + this.gen);
            // Recompute best player after applying snapshot
            try { this.SetBestPlayer(); } catch (e) {}
            return { generation: this.gen, level: this.currentBestLevelReached };
        } catch (e) {
            console.error('Failed to apply snapshot data', e);
            return null;
        }
    }

    // Load a snapshot file and apply it (wrapper that reads the file)
    async loadSnapshotFromFile(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data || data.type !== 'snapshot') return null;
            return this.applySnapshotData(data);
        } catch (e) {
            console.error('Failed to parse snapshot file', e);
            return null;
        }
    }

    CalculateFitnessSum() {
        this.fitnessSum = 0;
        for (let i = 0; i < this.players.length; i++) {
            this.players[i].CalculateFitness();
            // if (this.players[i].bestLevelReached < this.players[this.bestPlayerIndex].bestLevelReached) {
            //     this.players[i].fitness = 0;
            // }<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
            this.fitnessSum += this.players[i].fitness;
        }
    }

    SelectParent() {
        let rand = random(this.fitnessSum);
        let runningSum = 0;
        for (let i = 0; i < this.players.length; i++) {
            runningSum += this.players[i].fitness;
            if (runningSum > rand) {
                return this.players[i];
            }
        }
        return null;
    }
}