import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, Signer, BigNumber, constants, utils } from 'ethers';
import { time } from '@openzeppelin/test-helpers';

describe('NameRegistry', () => {
  let accounts: Signer[];
  let nameRegistry: Contract;
  let owner: Signer;
  let alice: Signer;
  let bob: Signer;
  const LOCK_AMOUNT = utils.parseEther('1');
  const FEE_PER_CHAR = utils.parseEther('0.01');
  const TREASURY = '0x8d0C82C753862bB40e14Ef927c0c0A9A168415d9'; // random address
  const LOCK_PERIOD = 3600 * 24 * 7; // 7 days
  const WAIT_BLOCKS = 2;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    [owner, alice, bob] = accounts;
    const NameRegistryFactory = await ethers.getContractFactory('NameRegistry');
    nameRegistry = await NameRegistryFactory.deploy(
      LOCK_AMOUNT,
      FEE_PER_CHAR,
      TREASURY,
      LOCK_PERIOD,
      WAIT_BLOCKS,
    );
  });

  describe('constructor', () => {
    it('revert if lock period is zero', async () => {
      const NameRegistryFactory = await ethers.getContractFactory(
        'NameRegistry',
      );
      expect(
        NameRegistryFactory.deploy(
          LOCK_AMOUNT,
          FEE_PER_CHAR,
          TREASURY,
          0,
          WAIT_BLOCKS,
        ),
      ).to.revertedWith('invalid period');
    });

    it('revert if lock amount is zero', async () => {
      const NameRegistryFactory = await ethers.getContractFactory(
        'NameRegistry',
      );
      expect(
        NameRegistryFactory.deploy(
          0,
          FEE_PER_CHAR,
          TREASURY,
          LOCK_PERIOD,
          WAIT_BLOCKS,
        ),
      ).to.revertedWith('invalid amount');
    });

    it('revert if treasury address is 0x0', async () => {
      const NameRegistryFactory = await ethers.getContractFactory(
        'NameRegistry',
      );
      expect(
        NameRegistryFactory.deploy(
          LOCK_AMOUNT,
          FEE_PER_CHAR,
          '0x0000000000000000000000000000000000000000',
          LOCK_PERIOD,
          WAIT_BLOCKS,
        ),
      ).to.revertedWith('invalid treasury');
    });

    it('check initial values', async () => {
      expect(await nameRegistry.lockAmount()).to.equal(LOCK_AMOUNT);
      expect(await nameRegistry.feePerChar()).to.equal(FEE_PER_CHAR);
      expect(await nameRegistry.treasury()).to.equal(TREASURY);
      expect(await nameRegistry.lockPeriod()).to.equal(LOCK_PERIOD);
      expect(await nameRegistry.waitBlocks()).to.equal(WAIT_BLOCKS);
    });
  });

  describe('#registerRequestSignature', () => {
    it('request signature for name register', async () => {
      const signature = await alice.signMessage(
        utils.arrayify(utils.id('test.eth')),
      );
      const tx = await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);
      const lastBlock = (await time.latestBlock()).toString();
      expect(tx)
        .to.emit(nameRegistry, 'SignatureRequested')
        .withArgs(await alice.getAddress(), signature);
      const requestSignature = await nameRegistry.requestSignatures(
        await alice.getAddress(),
      );
      expect(requestSignature.signature).to.equal(signature);
      expect(requestSignature.blockId).to.equal(lastBlock);
    });

    it('revert if request when pending is available', async () => {
      const signature1 = await alice.signMessage(
        utils.arrayify(utils.id('test.eth')),
      );
      const signature2 = await alice.signMessage(
        utils.arrayify(utils.id('test.eth1')),
      );
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(await alice.signMessage(signature1), false);
      expect(
        nameRegistry.connect(alice).registerRequestSignature(signature2, false),
      ).to.revertedWith('has pending request');
    });

    it('can force replace new signature', async () => {
      const signature1 = await alice.signMessage(
        utils.arrayify(utils.id('test.eth')),
      );
      const signature2 = await alice.signMessage(
        utils.arrayify(utils.id('test.eth1')),
      );
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature1, false);

      await time.advanceBlock();
      await time.advanceBlock();

      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature2, true);
      const requestSignature = await nameRegistry.requestSignatures(
        await alice.getAddress(),
      );
      const lastBlock = (await time.latestBlock()).toString();
      expect(requestSignature.signature).to.equal(signature2);
      expect(requestSignature.blockId).to.equal(lastBlock);
    });
  });

  describe('#registerName', () => {
    const name = 'test.eth';

    it('revert if no signature requested', async () => {
      expect(nameRegistry.connect(alice).registerName(name)).to.revertedWith(
        'no request or wait more blocks',
      );
    });

    it('revert if need to wait more blocks', async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      expect(nameRegistry.connect(alice).registerName(name)).to.revertedWith(
        'no request or wait more blocks',
      );
    });

    it('revert if name does not match with signature', async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      expect(
        nameRegistry.connect(alice).registerName('test.eth1'),
      ).to.revertedWith('invalid signature');
    });

    it('revert if not enough ether sent', async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      expect(nameRegistry.connect(alice).registerName(name)).to.revertedWith(
        'no enough ether',
      );
    });

    it('register name and send fee to treasury', async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      const tx = await nameRegistry
        .connect(alice)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });
      expect(tx)
        .to.emit(nameRegistry, 'NameRegistered')
        .withArgs(await alice.getAddress(), name, LOCK_AMOUNT);
      const registerTime = Number((await time.latest()).toString());
      expect(await alice.provider.getBalance(TREASURY)).to.equal(registerFee);
      expect(await alice.provider.getBalance(nameRegistry.address)).to.equal(
        LOCK_AMOUNT,
      );
      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(0);

      const record = await nameRegistry.records(name);
      expect(record.owner).to.equal(await alice.getAddress());
      expect(record.maturity).to.equal(registerTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);

      const requestSignature = await nameRegistry.requestSignatures(
        await alice.getAddress(),
      );
      expect(requestSignature.signature).to.equal('0x');
      expect(requestSignature.blockId).to.equal(0);
    });

    it('increase unlock amount if user send more ether than required', async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      const moreEther = utils.parseEther('0.5');
      const treasuryBalanceBefore = await alice.provider.getBalance(TREASURY);
      await nameRegistry.connect(alice).registerName(name, {
        value: LOCK_AMOUNT.add(registerFee).add(moreEther),
      });
      const registerTime = Number((await time.latest()).toString());
      expect(await alice.provider.getBalance(TREASURY)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );
      expect(await alice.provider.getBalance(nameRegistry.address)).to.equal(
        LOCK_AMOUNT.add(moreEther),
      );
      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(moreEther);

      const record = await nameRegistry.records(name);
      expect(record.owner).to.equal(await alice.getAddress());
      expect(record.maturity).to.equal(registerTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);

      const requestSignature = await nameRegistry.requestSignatures(
        await alice.getAddress(),
      );
      expect(requestSignature.signature).to.equal('0x');
      expect(requestSignature.blockId).to.equal(0);
    });

    it('revert if name already owned', async () => {
      const aliceSignature = await alice.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(aliceSignature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await nameRegistry
        .connect(alice)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });

      const bobSignature = await bob.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await nameRegistry
        .connect(bob)
        .registerRequestSignature(bobSignature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      expect(
        nameRegistry
          .connect(bob)
          .registerName(name, { value: LOCK_AMOUNT.add(registerFee) }),
      ).to.revertedWith('not expired');
    });

    it('replace owner if previous name has been expired', async () => {
      const aliceSignature = await alice.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(aliceSignature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await nameRegistry
        .connect(alice)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });

      await time.increase(LOCK_PERIOD);

      const bobSignature = await bob.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await nameRegistry
        .connect(bob)
        .registerRequestSignature(bobSignature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const tx = await nameRegistry
        .connect(bob)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });

      expect(tx)
        .to.emit(nameRegistry, 'EtherUnlocked')
        .withArgs(await alice.getAddress(), name, LOCK_AMOUNT);
      const registerTime = Number((await time.latest()).toString());
      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(LOCK_AMOUNT);

      const record = await nameRegistry.records(name);
      expect(record.owner).to.equal(await bob.getAddress());
      expect(record.maturity).to.equal(registerTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);
    });
  });

  describe('#renew', () => {
    const name = 'test.eth';

    beforeEach(async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await nameRegistry
        .connect(alice)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });
    });

    it('revert if not owner', async () => {
      expect(nameRegistry.connect(bob).renew(name)).to.revertedWith(
        'not owner',
      );
    });

    it('revert if not enough ether sent', async () => {
      expect(nameRegistry.connect(alice).renew(name)).to.revertedWith(
        'no enough ether',
      );
    });

    it('renew name and send fee to treasury', async () => {
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await time.increase(LOCK_PERIOD);
      const treasuryBalanceBefore = await alice.provider.getBalance(TREASURY);
      const tx = await nameRegistry
        .connect(alice)
        .renew(name, { value: registerFee });
      expect(tx)
        .to.emit(nameRegistry, 'NameRenew')
        .withArgs(await alice.getAddress(), name);
      const renewTime = Number((await time.latest()).toString());
      expect(await alice.provider.getBalance(TREASURY)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );

      const record = await nameRegistry.records(name);
      expect(record.owner).to.equal(await alice.getAddress());
      expect(record.maturity).to.equal(renewTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);
    });

    it('increase unlock amount if user send more ether than required', async () => {
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      const moreEther = utils.parseEther('0.5');
      await time.increase(LOCK_PERIOD);
      const treasuryBalanceBefore = await alice.provider.getBalance(TREASURY);
      await nameRegistry
        .connect(alice)
        .renew(name, { value: registerFee.add(moreEther) });

      expect(await alice.provider.getBalance(TREASURY)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );

      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(moreEther);
    });

    it('renew from maturity if not expired yet', async () => {
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await time.increase(LOCK_PERIOD / 2);
      let record = await nameRegistry.records(name);
      const maturity = Number(record.maturity.toString());
      const treasuryBalanceBefore = await alice.provider.getBalance(TREASURY);
      await nameRegistry.connect(alice).renew(name, { value: registerFee });
      expect(await alice.provider.getBalance(TREASURY)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );

      record = await nameRegistry.records(name);
      expect(record.owner).to.equal(await alice.getAddress());
      expect(record.maturity).to.equal(maturity + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);
    });
  });

  describe('#unlock', () => {
    const name = 'test.eth';

    beforeEach(async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await nameRegistry
        .connect(alice)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });
    });

    it('revert if not owner', async () => {
      await time.increase(LOCK_PERIOD);
      expect(nameRegistry.connect(bob).unlock(name)).to.revertedWith(
        'invalid owner or not expired',
      );
    });

    it('revert if not expired', async () => {
      expect(nameRegistry.connect(alice).unlock(name)).to.revertedWith(
        'invalid owner or not expired',
      );
    });

    it('unlock ether for expired name and withdraw', async () => {
      await time.increase(LOCK_PERIOD);
      const aliceBalanceBefore = await alice.provider.getBalance(
        await alice.getAddress(),
      );
      const tx = await nameRegistry.connect(alice).unlock(name);
      expect(tx)
        .to.emit(nameRegistry, 'EtherUnlocked')
        .withArgs(await alice.getAddress(), name, LOCK_AMOUNT);
      const receipt = await tx.wait(1);
      const gas = receipt.gasUsed.mul(tx.gasPrice);
      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(0);
      expect(
        await alice.provider.getBalance(await alice.getAddress()),
      ).to.equal(aliceBalanceBefore.add(LOCK_AMOUNT).sub(gas));

      const record = await nameRegistry.records(name);
      expect(record.owner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(record.maturity).to.equal(0);
      expect(record.lockAmount).to.equal(0);
    });

    it('unlock ether for expired name and withdraw all unlocked funds', async () => {
      const name1 = 'test.eth1';
      const signature = await alice.signMessage(
        utils.arrayify(utils.id(name1)),
      );
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name1.length));
      const moreEther = utils.parseEther('0.5');
      await nameRegistry.connect(alice).registerName(name1, {
        value: LOCK_AMOUNT.add(registerFee).add(moreEther),
      });

      await time.increase(LOCK_PERIOD);
      const aliceBalanceBefore = await alice.provider.getBalance(
        await alice.getAddress(),
      );
      const tx = await nameRegistry.connect(alice).unlock(name);
      const receipt = await tx.wait(1);
      const gas = receipt.gasUsed.mul(tx.gasPrice);
      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(0);
      expect(
        await alice.provider.getBalance(await alice.getAddress()),
      ).to.equal(aliceBalanceBefore.add(LOCK_AMOUNT).add(moreEther).sub(gas));

      const record = await nameRegistry.records(name);
      expect(record.owner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(record.maturity).to.equal(0);
      expect(record.lockAmount).to.equal(0);
    });
  });

  describe('#withdrawUnlockedEther', () => {
    const name = 'test.eth';
    const moreEther = utils.parseEther('0.5');

    beforeEach(async () => {
      const signature = await alice.signMessage(utils.arrayify(utils.id(name)));
      await nameRegistry
        .connect(alice)
        .registerRequestSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await nameRegistry.connect(alice).registerName(name, {
        value: LOCK_AMOUNT.add(registerFee).add(moreEther),
      });
    });

    it('revert if no ether unlocked', async () => {
      expect(nameRegistry.connect(bob).withdrawUnlockedEther()).to.revertedWith(
        'no ether unlocked',
      );
    });

    it('withdraw unlocked ether', async () => {
      const aliceBalanceBefore = await alice.provider.getBalance(
        await alice.getAddress(),
      );
      const tx = await nameRegistry.connect(alice).withdrawUnlockedEther();
      const receipt = await tx.wait(1);
      const gas = receipt.gasUsed.mul(tx.gasPrice);
      expect(
        await nameRegistry.unlockedEthers(await alice.getAddress()),
      ).to.equal(0);
      expect(
        await alice.provider.getBalance(await alice.getAddress()),
      ).to.equal(aliceBalanceBefore.add(moreEther).sub(gas));
    });
  });

  describe('#setLockPeriod', () => {
    const newLockPeriod = 3600 * 24;

    it('revert if msg.sender is not owner', async () => {
      expect(
        nameRegistry.connect(alice).setLockPeriod(newLockPeriod),
      ).to.revertedWith('Ownable: caller is not the owner');
    });

    it('revert if amount is zero', async () => {
      expect(nameRegistry.connect(owner).setLockPeriod(0)).to.revertedWith(
        'invalid period',
      );
    });

    it('update lock period', async () => {
      await nameRegistry.connect(owner).setLockPeriod(newLockPeriod);

      expect(await nameRegistry.lockPeriod()).to.equal(newLockPeriod);
    });
  });

  describe('#setLockAmount', () => {
    const newLockAmount = utils.parseEther('2');

    it('revert if msg.sender is not owner', async () => {
      expect(
        nameRegistry.connect(alice).setLockAmount(newLockAmount),
      ).to.revertedWith('Ownable: caller is not the owner');
    });

    it('revert if amount is zero', async () => {
      expect(nameRegistry.connect(owner).setLockAmount(0)).to.revertedWith(
        'invalid amount',
      );
    });

    it('update lock amount', async () => {
      await nameRegistry.connect(owner).setLockAmount(newLockAmount);

      expect(await nameRegistry.lockAmount()).to.equal(newLockAmount);
    });
  });

  describe('#setFeePerChar', () => {
    const newFeePerChar = utils.parseEther('0.1');

    it('revert if msg.sender is not owner', async () => {
      expect(
        nameRegistry.connect(alice).setFeePerChar(newFeePerChar),
      ).to.revertedWith('Ownable: caller is not the owner');
    });

    it('update lock amount', async () => {
      await nameRegistry.connect(owner).setFeePerChar(newFeePerChar);

      expect(await nameRegistry.feePerChar()).to.equal(newFeePerChar);
    });
  });

  describe('#setTreasury', () => {
    const newTreasury = '0xA23E5aEa36e7c2612102C82224cDc32021759e0d';

    it('revert if msg.sender is not owner', async () => {
      expect(
        nameRegistry.connect(alice).setTreasury(newTreasury),
      ).to.revertedWith('Ownable: caller is not the owner');
    });

    it('revert if address is zero', async () => {
      expect(
        nameRegistry
          .connect(owner)
          .setTreasury('0x0000000000000000000000000000000000000000'),
      ).to.revertedWith('invalid treasury');
    });

    it('update treasury', async () => {
      await nameRegistry.connect(owner).setTreasury(newTreasury);

      expect(await nameRegistry.treasury()).to.equal(newTreasury);
    });
  });

  describe('#setWaitBlocks', () => {
    const newWaitBlocks = 5;

    it('revert if msg.sender is not owner', async () => {
      expect(
        nameRegistry.connect(alice).setWaitBlocks(newWaitBlocks),
      ).to.revertedWith('Ownable: caller is not the owner');
    });

    it('update lock amount', async () => {
      await nameRegistry.connect(owner).setWaitBlocks(newWaitBlocks);

      expect(await nameRegistry.waitBlocks()).to.equal(newWaitBlocks);
    });
  });
});
