/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const utils = require('./util/wallet');

const bcoin = require('bcoin');
const {KeyRing, MTX, Amount, hd} = bcoin;
const WalletDB = bcoin.wallet.WalletDB;
const WalletNodeClient = require('../lib/walletclient');
const MultisigDB = require('../lib/multisigdb');
const Cosigner = require('../lib/cosigner');

const TEST_XPUB_PATH = 'm/44\'/0\'/0\'';
const TEST_WALLET_ID = 'test';

const TEST_COSIGNER_1 = 'cosigner1';
const TEST_COSIGNER_2 = 'cosinger2';

const TEST_M = 2;
const TEST_N = 2;

describe('MultisigProposals', function () {
  // 2-of-2 will be used for tests
  const xpub1 = getPubKey();
  const xpub2 = getPubKey();

  let wdb, msdb;
  let mswallet, wallet, pdb;

  let cosigner1, cosigner2;

  beforeEach(async () => {
    wdb = new WalletDB();

    const wdbClient = new WalletNodeClient({});
    wdbClient.wdb = wdb;

    msdb = new MultisigDB({
      client: wdbClient
    });

    await wdb.open();
    await msdb.open();

    mswallet = await msdb.create({
      id: TEST_WALLET_ID,
      m: TEST_M,
      n: TEST_N
    }, Cosigner.fromOptions({ name: TEST_COSIGNER_1 }), xpub1);

    wallet = mswallet.wallet;

    const joined = await msdb.join(TEST_WALLET_ID, Cosigner.fromOptions({
      name: TEST_COSIGNER_2
    }), xpub2);

    assert(joined, 'Could not join the wallet');

    pdb = mswallet.pdb;

    cosigner1 = mswallet.cosigners[0];
    cosigner2 = mswallet.cosigners[1];
  });

  afterEach(async () => {
    await wdb.close();
    await msdb.close();
  });

  it('should create pdb with wallet', async () => {
    assert.strictEqual(mswallet.isInitialized(), true,
      'Wallet was not initalized');
    assert(mswallet, 'Multisig wallet not found');
    assert(pdb, 'ProposalsDB not found');
  });

  it('should create transaction', async () => {
    await utils.fundWalletBlock(wdb, mswallet, 1);

    const account = await mswallet.getAccount();
    const address = account.receiveAddress();

    const txoptions = {
      subtractFee: true,
      outputs: [{
        address: address,
        value: Amount.fromBTC(1).toValue()
      }]
    };

    const tx = await mswallet.createTX(txoptions);

    assert.instanceOf(tx, MTX);
    assert.strictEqual(tx.isSane(), true);
  });

  it('should lock the coins and recover locked coins', async () => {
    // this is mostly wallet test than proposal
    await utils.fundWalletBlock(wdb, mswallet, 1);

    const coins = await wallet.getCoins();
    assert.strictEqual(coins.length, 1);

    const txoptions = {
      subtractFee: true,
      outputs: [{
        address: generateAddress(),
        value: Amount.fromBTC(1).toValue()
      }]
    };

    // create proposal
    const mtx = await mswallet.createTX(txoptions);
    assert.instanceOf(mtx, MTX);

    for (const coin of coins)
      await mswallet.lockCoin(coin);

    let err;
    try {
      await mswallet.createTX(txoptions);
    } catch (e) {
      err = e;
    }

    const message = 'Not enough funds. (available=0.0, required=1.0)';
    assert(err);
    assert.strictEqual(err.message, message);

    for (const coin of coins)
      await mswallet.unlockCoin(coin);

    const mtx2 = await mswallet.createTX(txoptions);
    assert.instanceOf(mtx2, MTX);
  });
});

/*
 * Helpers
 */

function getPubKey() {
  return hd.PrivateKey.generate()
    .derivePath(TEST_XPUB_PATH).toPublic();
}

function generateAddress() {
  return KeyRing.generate().getAddress();
}
