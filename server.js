const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// 1. 파이어베이스 클라이언트 모듈 불러오기
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set } = require('firebase/database');

// 2. 알려주신 파이어베이스 웹 설정 적용
const firebaseConfig = {
    apiKey: "AIzaSyBnwTE1Gj5eI4HqtmgbuUXOBHGNxotaS5A",
    authDomain: "tower-defense-14a58.firebaseapp.com",
    databaseURL: "https://tower-defense-14a58-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "tower-defense-14a58",
    storageBucket: "tower-defense-14a58.firebasestorage.app",
    messagingSenderId: "134914642568",
    appId: "1:134914642568:web:adf4cb801310ec38aa053d",
    measurementId: "G-2S2WX67L9X"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const usersRef = ref(db, 'users');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let users = {};

// 서버가 켜질 때 데이터 불러오기
get(usersRef).then((snapshot) => {
    if (snapshot.exists()) {
        users = snapshot.val();
    }
    console.log('🔥 Firebase 유저 데이터 로드 완료!');
}).catch((error) => {
    console.error(error);
});

// 데이터 저장 함수
function saveUsers() {
    set(usersRef, users);
}

const activeUsers = {};
const parties = {};

// --------------------------------------------------------
// 여기서부터는 아래의 기존 코드 그대로 유지하시면 됩니다!
const basicTowers = [
    'Archer', 'Cannon', 'Castle', 'Crystal', 'Electricity', 
    'Fire', 'Galaxy', 'Heal', 'Ice', 'Laser', 
    'Magic', 'Outpost', 'Poison', 'Sniper', 'Steampunk', 'Tree'
];

const upgradeTowers = [
    'Upgrade_Cannon', 'Upgrade_Electricity', 'Upgrade_Fire', 'Upgrade_Ice'
];

const towerList = [...basicTowers, ...upgradeTowers];

const gachaTiers = [
    { name: 'Common', rate: 49.99, color: '#e6e6e6' },
    { name: 'Uncommon', rate: 30.0, color: '#2eb82e' },
    { name: 'Rare', rate: 15.0, color: '#4da6ff' },
    { name: 'Epic', rate: 4.0, color: '#b19cd9' },
    { name: 'Legendary', rate: 0.8, color: '#ffd700' },
    { name: 'Mythical', rate: 0.2, color: '#ff4d4d' },
    { name: 'Godly', rate: 0.01, color: '#000080' }
];

let currentSummonPool = [];
let poolTimerSeconds = 300;

function updateSummonPool() {
    currentSummonPool = gachaTiers.map(tier => {
        let pool = basicTowers;
        if (['Epic', 'Legendary', 'Mythical', 'Godly'].includes(tier.name)) {
            pool = [...basicTowers, ...upgradeTowers];
        }
        const randomTower = pool[Math.floor(Math.random() * pool.length)];
        return { tier: tier.name, rate: tier.rate, color: tier.color, tower: randomTower };
    });
    poolTimerSeconds = 300;
    io.emit('summon_pool_update', { pool: currentSummonPool, timeLeft: poolTimerSeconds });
}

setInterval(updateSummonPool, 5 * 60 * 1000);
setInterval(() => {
    if (poolTimerSeconds > 0) {
        poolTimerSeconds--;
    } else {
        updateSummonPool();
    }
    io.emit('pool_timer_update', poolTimerSeconds);
}, 1000);
updateSummonPool();

function rollSummon(count = 1) {
    const results = [];
    for (let c = 0; c < count; c++) {
        const randomVal = Math.random() * 100;
        let accumulatedRate = 0;
        let selectedTierObj = gachaTiers[0];
        
        for (const tier of gachaTiers) {
            accumulatedRate += tier.rate;
            if (randomVal <= accumulatedRate) {
                selectedTierObj = tier;
                break;
            }
        }
        const poolItem = currentSummonPool.find(p => p.tier === selectedTierObj.name);
        const towerName = poolItem ? poolItem.tower : towerList[0];
        results.push({ tier: selectedTierObj.name, tower: towerName, color: selectedTierObj.color });
    }
    return results;
}

function getVisibleParties() {
    return Object.values(parties).filter(p => !p.started);
}

io.on('connection', (socket) => {
    socket.on('signup', ({ username, password }) => {
        if (!username || !password) {
            socket.emit('alert', '아이디와 비밀번호를 모두 입력해주세요.');
            return;
        }
        if (users[username]) {
            socket.emit('alert', '이미 존재하는 닉네임(아이디)입니다.');
            return;
        }
        users[username] = {
            username: username,
            password: password,
            coins: 5000,
            wins: 0,
            x: 570,
            y: 240,
            color: '#' + Math.floor(Math.random()*16777215).toString(16),
            hotbar: ['Archer', 'Cannon', 'Fire', 'Ice', 'Sniper'],
            inventory: [
                { name: 'Archer', tier: 'Common', color: '#e6e6e6' },
                { name: 'Cannon', tier: 'Uncommon', color: '#2eb82e' },
                { name: 'Fire', tier: 'Rare', color: '#4da6ff' },
                { name: 'Ice', tier: 'Epic', color: '#b19cd9' },
                { name: 'Sniper', tier: 'Legendary', color: '#ffd700' }
            ]
        };
        saveUsers();
        socket.emit('signup_success', '회원가입이 완료되었습니다. 로그인해주세요.');
    });

    socket.on('login', ({ username, password }) => {
        const user = users[username];
        if (!user || user.password !== password) {
            socket.emit('alert', '아이디 또는 비밀번호가 일치하지 않습니다.');
            return;
        }
        activeUsers[socket.id] = user;
        socket.emit('login_success', user);
        socket.emit('summon_pool_update', { pool: currentSummonPool, timeLeft: poolTimerSeconds });
        broadcastRankings();
        io.emit('party_list_update', getVisibleParties());
    });

    socket.on('player_move', (pos) => {
        const user = activeUsers[socket.id];
        if (user) {
            user.x = pos.x;
            user.y = pos.y;
            socket.broadcast.emit('other_player_moved', user);
        }
    });

    socket.on('summon_pull', (count) => {
        const user = activeUsers[socket.id];
        const cost = count === 10 ? 900 : 100;
        if (!user || user.coins < cost) {
            socket.emit('notification', `코인이 부족합니다! (필요: ${cost}코인)`);
            return;
        }
        user.coins -= cost;
        const results = rollSummon(count);
        
        results.forEach(res => {
            user.inventory.push({ name: res.tower, tier: res.tier, color: res.color });
        });
        
        saveUsers();
        socket.emit('summon_result', { results, coins: user.coins, inventory: user.inventory });
        broadcastRankings();
    });

    socket.on('equip_tower', ({ slotIndex, towerName }) => {
        const user = activeUsers[socket.id];
        if (user) {
            const item = user.inventory.find(i => i.name === towerName);
            if (item) {
                user.hotbar[slotIndex] = item.name;
                saveUsers();
                socket.emit('hotbar_updated', user.hotbar);
            }
        }
    });

    socket.on('unequip_slot', (slotIndex) => {
        const user = activeUsers[socket.id];
        if (user && user.hotbar[slotIndex]) {
            user.hotbar[slotIndex] = null;
            saveUsers();
            socket.emit('hotbar_updated', user.hotbar);
        }
    });

    socket.on('create_party', (data) => {
        const user = activeUsers[socket.id];
        if (!user) return;
        const partyId = 'party_' + Math.random().toString(36).substring(2, 7);
        parties[partyId] = {
            id: partyId,
            host: user.username,
            difficulty: data.difficulty || 'Easy',
            maxMembers: 4,
            members: [user.username],
            started: false
        };
        socket.join(partyId);
        socket.emit('party_created', parties[partyId]);
        io.emit('party_list_update', getVisibleParties());
    });

    socket.on('get_party_list', () => {
        socket.emit('party_list_update', getVisibleParties());
    });

    socket.on('join_party', (partyId) => {
        const party = parties[partyId];
        const user = activeUsers[socket.id];
        if (party && user && party.members.length < party.maxMembers && !party.started) {
            if (!party.members.includes(user.username)) {
                party.members.push(user.username);
            }
            socket.join(partyId);
            io.emit('party_list_update', getVisibleParties());
            socket.emit('joined_party_success', party);
        } else {
            socket.emit('notification', '파티에 참가할 수 없거나 이미 시작된 게임입니다.');
        }
    });

    socket.on('leave_party', (partyId) => {
        const party = parties[partyId];
        const user = activeUsers[socket.id];
        if (party && user) {
            party.members = party.members.filter(m => m !== user.username);
            socket.leave(partyId);
            if (party.members.length === 0) {
                delete parties[partyId];
            } else if (party.host === user.username) {
                party.host = party.members[0];
            }
            socket.emit('left_party_success');
            io.emit('party_list_update', getVisibleParties());
        }
    });

    socket.on('start_game', (partyId) => {
        const party = parties[partyId];
        const user = activeUsers[socket.id];
        if (party && user && party.host === user.username) {
            party.started = true;
            io.emit('party_list_update', getVisibleParties());
            io.to(partyId).emit('game_started', party);
        }
    });

    socket.on('clear_game', ({ difficulty, partyId }) => {
        const user = activeUsers[socket.id];
        if (!user) return;
        
        let rewardCoins = 200;
        let rewardWins = 1;
        if (difficulty === 'Normal') { rewardCoins = 500; rewardWins = 1; }
        else if (difficulty === 'Hard') { rewardCoins = 1000; rewardWins = 2; }
        else if (difficulty === 'Extreme') { rewardCoins = 2000; rewardWins = 3; }

        user.coins += rewardCoins;
        user.wins += rewardWins;
        saveUsers();
        socket.emit('clear_reward_success', { coins: user.coins, wins: user.wins, rewardCoins, rewardWins });
        broadcastRankings();

        if (partyId && parties[partyId]) {
            io.in(partyId).socketsLeave(partyId);
            delete parties[partyId];
            io.emit('party_list_update', getVisibleParties());
        }
    });

    socket.on('chat_message', (msg) => {
        const user = activeUsers[socket.id];
        if (user && msg) {
            io.emit('chat_broadcast', { username: user.username, message: msg, color: user.color || '#fff' });
        }
    });

    socket.on('disconnect', () => {
        const user = activeUsers[socket.id];
        if (user) {
            for (const pId in parties) {
                const party = parties[pId];
                if (party.members.includes(user.username)) {
                    party.members = party.members.filter(m => m !== user.username);
                    if (party.members.length === 0) {
                        delete parties[pId];
                    } else if (party.host === user.username) {
                        party.host = party.members[0];
                    }
                }
            }
            io.emit('party_list_update', getVisibleParties());
        }
        delete activeUsers[socket.id];
        socket.broadcast.emit('player_left', socket.id);
    });
});

function broadcastRankings() {
    const userList = Object.values(users);
    const coinRanking = [...userList].sort((a, b) => b.coins - a.coins).slice(0, 100);
    const winRanking = [...userList].sort((a, b) => b.wins - a.wins).slice(0, 100);
    io.emit('rankings_update', { coinRanking, winRanking });
}

server.listen(process.env.PORT || 3000, () => {
    console.log('게임 서버 실행 중 (포트 3000)');
});