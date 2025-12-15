/*
 * PPO Brain implemented with TensorFlow.js
 * - policy model outputs logits for discrete actions
 * - value model outputs a scalar state-value
 * - buffer stores trajectories per player; training happens in Population.NaturalSelection
 *
 * Notes:
 * - This implementation aims to be functional and reasonably lightweight for browser use.
 * - It serializes model weights into a single downloadable JSON so the existing save/load UI keeps working.
 */

// helper: ensure tf is present
if (typeof tf === 'undefined') {
    console.warn('TensorFlow.js not found. PPO Brain requires tfjs. Add <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs"></script>');
}

class AIAction {
    constructor(isJump, holdTime, xDirection) {
        this.isJump = isJump;
        this.holdTime = holdTime;
        this.xDirection = xDirection;
    }
}

class Brain {
    constructor(bufferSize = 1000, obsSize = 12, actionSize = 18) {
        this.type = 'PPO';
        this.instructions = new Array(bufferSize);
        this.currentInstructionNumber = 0;
        this.obsSize = obsSize;
        this.actionSize = actionSize;

        // Build policy and value nets
        this._buildModels();

        // Per-brain buffer: array of steps {obs, action, logp, value}
        this.buffer = [];
    }

    _buildModels() {
        if (typeof tf === 'undefined') return;
        // Policy network: small MLP -> logits
        this.policyModel = tf.sequential();
        this.policyModel.add(tf.layers.dense({units: 64, activation: 'relu', inputShape: [this.obsSize]}));
        this.policyModel.add(tf.layers.dense({units: 64, activation: 'relu'}));
        this.policyModel.add(tf.layers.dense({units: this.actionSize})); // logits

        // Value network
        this.valueModel = tf.sequential();
        this.valueModel.add(tf.layers.dense({units: 64, activation: 'relu', inputShape: [this.obsSize]}));
        this.valueModel.add(tf.layers.dense({units: 64, activation: 'relu'}));
        this.valueModel.add(tf.layers.dense({units: 1}));

        this.policyOptimizer = tf.train.adam(1e-3);
        this.valueOptimizer = tf.train.adam(1e-3);
    }

    // Convert Player to observation vector
    _getObservationFromPlayer(player) {
        // Add a few extra normalized features to help learning:
        // - player position (x,y) normalized
        // - previous velocity (x,y) normalized
        // Keep legacy features too so networks remain compatible-ish.
        return [
            player.isOnGround ? 1 : 0,
            player.currentSpeed.x / 20,
            player.currentSpeed.y / 20,
            (height - player.currentPos.y) / height,
            player.currentLevelNo / 40,
            player.bestLevelReached / 40,
            player.facingRight ? 1 : 0,
            player.blizzardForce / 1,
            // new features
            (player.currentPos.x || 0) / (width || 1),
            (player.currentPos.y || 0) / (height || 1),
            (player.previousSpeed ? player.previousSpeed.x : 0) / 20,
            (player.previousSpeed ? player.previousSpeed.y : 0) / 20
        ];
    }

    // sample action and record step info
    getNextActionForPlayer(player) {
        // Respect the instruction length (so players finish like the original GA brain)
        if (this.currentInstructionNumber >= this.instructions.length) {
            return null;
        }

        if (typeof tf === 'undefined') {
            // fallback to simple random action
            let idx = Math.floor(Math.random() * this.actionSize);
            this.currentInstructionNumber += 1;
            return this._actionIndexToAIAction(idx);
        }

        const obs = this._getObservationFromPlayer(player);
        return tf.tidy(() => {
            const obsT = tf.tensor([obs]);
            const logits = this.policyModel.predict(obsT);
            const logitsArr = logits.arraySync()[0];
            const probs = softmax(logitsArr);
            const action = categoricalSample(probs);
            const logp = Math.log(probs[action] + 1e-8);
            const value = this.valueModel.predict(obsT).arraySync()[0][0];

            // store step and record current fitness/height/coins for per-step rewards
            try { player.CalculateFitness(); } catch (e) {}
            const baseFitness = player.fitness || 0;
            const baseHeight = (player.bestHeightReached !== undefined) ? player.bestHeightReached : 0;
            const baseLevel = (player.bestLevelReached !== undefined) ? player.bestLevelReached : 0;
            const baseCoins = (player.numberOfCoinsPickedUp !== undefined) ? player.numberOfCoinsPickedUp : 0;
            if (this.startFitness === undefined) this.startFitness = baseFitness;
            this.buffer.push({ obs, action, logp, value, baseFitness, baseHeight, baseLevel, baseCoins });
            this.currentInstructionNumber += 1;
            return this._actionIndexToAIAction(action);
        });
    }

    getNextAction() {
        // backwards compatible random fallback
        let idx = Math.floor(Math.random() * this.actionSize);
        this.currentInstructionNumber += 1;
        return this._actionIndexToAIAction(idx);
    }

    _actionIndexToAIAction(idx) {
        let holdBucket = idx % 3; idx = Math.floor(idx / 3);
        let xBucket = idx % 3; idx = Math.floor(idx / 3);
        let jumpBucket = idx % 2;
        let isJump = jumpBucket === 1;
        let xDirection = xBucket === 0 ? -1 : (xBucket === 1 ? 0 : 1);
        let holdTime = 0.1 + (holdBucket / 2) * 0.9;
        return new AIAction(isJump, holdTime, xDirection);
    }

    // Train policy/value using collected buffers across players (called by Population)
    async trainOnAggregatedBuffer(aggregatedSteps, opts = {}) {
        if (typeof tf === 'undefined') return;

        // hyperparameters (can be overridden by opts)
        const epochs = opts.epochs || 3;
        const clipRatio = opts.clipRatio || 0.2;
        const batchSize = opts.batchSize || 32;
        const policyLr = opts.policyLr || 1e-4;
        const valueLr = opts.valueLr || 1e-3;
        const entropyCoef = (opts.entropyCoef !== undefined) ? opts.entropyCoef : 1e-3;

        if (!aggregatedSteps || aggregatedSteps.length === 0) return;

        // Prepare arrays
        const obsArr = aggregatedSteps.map(s => s.obs);
        const actArr = aggregatedSteps.map(s => s.action);
        const retArr = aggregatedSteps.map(s => s.return);
        let advArr = aggregatedSteps.map(s => s.adv);
        const oldLogpArr = aggregatedSteps.map(s => s.logp);

        // Normalize advantages to stabilize training
        try {
            const mean = advArr.reduce((a, b) => a + b, 0) / advArr.length;
            const variance = advArr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / advArr.length;
            const std = Math.sqrt(variance) + 1e-8;
            advArr = advArr.map(a => (a - mean) / std);
        } catch (e) {}

        // Convert to tensors
        const obsT = tf.tensor(obsArr);
        const actsT = tf.tensor1d(actArr, 'int32');
        const retsT = tf.tensor1d(retArr);
        const advsT = tf.tensor1d(advArr);
        const oldLogpT = tf.tensor1d(oldLogpArr);

        const num = obsArr.length;
        const indices = [...Array(num).keys()];

        // Use local optimizers with tuned learning rates for this training call
        const policyOpt = tf.train.adam(policyLr);
        const valueOpt = tf.train.adam(valueLr);

        for (let e = 0; e < epochs; e++) {
            shuffle(indices);
            for (let start = 0; start < num; start += batchSize) {
                const end = Math.min(start + batchSize, num);
                const batchIdx = indices.slice(start, end);
                const bObs = tf.gather(obsT, batchIdx);
                const bActs = tf.gather(actsT, batchIdx);
                const bAdvs = tf.gather(advsT, batchIdx);
                const bRets = tf.gather(retsT, batchIdx);
                const bOldLogp = tf.gather(oldLogpT, batchIdx);

                // policy update
                await policyOpt.minimize(() => {
                    const logits = this.policyModel.predict(bObs);
                    const logpAll = tf.logSoftmax(logits);
                    const actIndices = tf.stack([tf.range(0, bActs.shape[0], 1, 'int32'), bActs], 1);
                    const logp = tf.gatherND(logpAll, actIndices);
                    const ratio = tf.exp(logp.sub(bOldLogp));
                    const unclipped = ratio.mul(bAdvs);
                    const clipped = tf.clipByValue(ratio, 1 - clipRatio, 1 + clipRatio).mul(bAdvs);
                    const policyLoss = tf.neg(tf.mean(tf.minimum(unclipped, clipped)));
                    // entropy bonus
                    const entropy = tf.mean(tf.neg(tf.sum(tf.mul(tf.exp(logpAll), logpAll), 1)));
                    const loss = policyLoss.sub(entropy.mul(entropyCoef));
                    return loss;
                }, true);

                // value update
                await valueOpt.minimize(() => {
                    const v = this.valueModel.predict(bObs).reshape([bRets.shape[0]]);
                    const valueLoss = tf.mean(tf.square(v.sub(bRets)));
                    return valueLoss.mul(0.5);
                }, true);

                tf.dispose([bObs, bActs, bAdvs, bRets, bOldLogp]);
            }
        }

        tf.dispose([obsT, actsT, retsT, advsT, oldLogpT]);
    }

    static fromJSON(obj) {
        if (!obj) return null;
        if (obj.type === 'PPO') {
            const b = new Brain(obj.instructionsLength || 1000);
            if (typeof tf !== 'undefined' && obj.policy && obj.value) {
                deserializeModelWeights(b.policyModel, obj.policy);
                deserializeModelWeights(b.valueModel, obj.value);
            } else if (obj.instructions) {
                b.instructions = obj.instructions.map(a => new AIAction(a.isJump, a.holdTime, a.xDirection));
            }
            return b;
        }
        // fallback legacy
        if (obj.instructions) {
            const b = new Brain(obj.instructions.length || 1000);
            b.instructions = obj.instructions.map(a => new AIAction(a.isJump, a.holdTime, a.xDirection));
            return b;
        }
        return null;
    }

    // Save downloadable single JSON containing both models + metadata
    static saveBestBrainToFile(brain, gen) {
        try {
            const obj = { type: 'ppo-brain', generation: gen, savedAt: new Date().toISOString(), brain: brain.toJSON() };
            const json = JSON.stringify(obj, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const filename = 'jumpking_ppo_brain_gen_' + gen + '.json';
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            console.log('PPO brain file created: ' + filename);
        } catch (e) {
            console.error('Failed to save PPO brain', e);
        }
    }

    static async loadBestBrainFromFile(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const brainData = data.brain ? data.brain : data;
            const generation = data.generation || 0;
            const brain = Brain.fromJSON(brainData);
            return { brain, generation };
        } catch (err) {
            console.error('Failed to parse brain file:', err);
            return null;
        }
    }
}

// --- utility helpers ---
function softmax(arr) {
    const max = Math.max(...arr);
    const exps = arr.map(a => Math.exp(a - max));
    const sum = exps.reduce((s, v) => s + v, 0);
    return exps.map(e => e / sum);
}

function categoricalSample(probs) {
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (r <= acc) return i; }
    return probs.length - 1;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
}

function copyModelWeights(fromModel, toModel) {
    if (typeof tf === 'undefined') return;
    const fromW = fromModel.getWeights();
    const cloned = fromW.map(w => w.clone());
    toModel.setWeights(cloned);
    for (let t of cloned) t.dispose();
}

function serializeModelWeights(model) {
    const weights = model.getWeights();
    const out = weights.map(w => ({ shape: w.shape, data: Array.from(w.dataSync()) }));
    return out;
}

function deserializeModelWeights(model, serialized) {
    if (typeof tf === 'undefined' || !serialized) return;
    const tensors = serialized.map(s => tf.tensor(s.data, s.shape));
    model.setWeights(tensors);
    for (let t of tensors) t.dispose();
}

// ----- Compatibility helpers (clone, serialize, mutate) -----
Brain.prototype.clone = function () {
    const b = new Brain(this.instructions.length || 1000, this.obsSize, this.actionSize);
    // copy instructions array (shallow copy)
    try { b.instructions = this.instructions.slice(); } catch (e) { b.instructions = new Array(this.instructions.length); }
    b.currentInstructionNumber = this.currentInstructionNumber || 0;
    // copy model weights if tf available
    if (typeof tf !== 'undefined' && this.policyModel && this.valueModel) {
        try {
            copyModelWeights(this.policyModel, b.policyModel);
            copyModelWeights(this.valueModel, b.valueModel);
        } catch (e) {
            console.warn('Failed to copy model weights on clone', e);
        }
    }
    return b;
};

Brain.prototype.toJSON = function () {
    const out = { type: 'PPO', instructionsLength: this.instructions ? this.instructions.length : 0, instructions: [] };
    try {
        if (this.instructions && this.instructions.length > 0) {
            out.instructions = this.instructions.map(a => a ? { isJump: a.isJump, holdTime: a.holdTime, xDirection: a.xDirection } : null);
        }
    } catch (e) {}
    if (typeof tf !== 'undefined' && this.policyModel && this.valueModel) {
        try {
            out.policy = serializeModelWeights(this.policyModel);
            out.value = serializeModelWeights(this.valueModel);
        } catch (e) { console.warn('Failed to serialize model weights', e); }
    }
    out.currentInstructionNumber = this.currentInstructionNumber || 0;
    return out;
};

Brain.prototype.increaseMoves = function (amount) {
    if (!this.instructions) this.instructions = [];
    for (let i = 0; i < amount; i++) this.instructions.push(null);
};

Brain.prototype.mutate = function () {
    if (typeof tf === 'undefined') return;
    // apply small random noise to weights
    try {
        const pW = this.policyModel.getWeights();
        const newPW = pW.map(w => {
            const data = Array.from(w.dataSync());
            for (let i = 0; i < data.length; i++) data[i] += (Math.random() - 0.5) * 0.02;
            const t = tf.tensor(data, w.shape);
            return t;
        });
        this.policyModel.setWeights(newPW);
        for (let t of newPW) t.dispose();
        for (let t of pW) t.dispose();

        const vW = this.valueModel.getWeights();
        const newVW = vW.map(w => {
            const data = Array.from(w.dataSync());
            for (let i = 0; i < data.length; i++) data[i] += (Math.random() - 0.5) * 0.02;
            const t = tf.tensor(data, w.shape);
            return t;
        });
        this.valueModel.setWeights(newVW);
        for (let t of newVW) t.dispose();
        for (let t of vW) t.dispose();
    } catch (e) {
        console.warn('Mutation failed', e);
    }
};

Brain.prototype.mutateActionNumber = function (actionNo) {
    // best-effort: if instructions array exists, randomize that index
    if (!this.instructions || actionNo === undefined || actionNo < 0 || actionNo >= this.instructions.length) return;
    this.instructions[actionNo] = this._actionIndexToAIAction(Math.floor(Math.random() * this.actionSize));
};
