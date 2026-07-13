import { expect } from 'chai';
import { network } from 'hardhat';

describe('SweepEscrow', () => {
  async function deployFixture() {
    const { ethers } = await network.connect();
    // owner = YIELD operator key (orchestrates); account = a YIELD user's on-chain treasury.
    const [owner, account] = await ethers.getSigners();
    const SweepEscrow = await ethers.getContractFactory('SweepEscrow');
    const escrow = await SweepEscrow.deploy();
    return { ethers, escrow, owner, account };
  }

  it('owner deposits on behalf of an account and balance is tracked per account', async () => {
    const { escrow, owner, account } = await deployFixture();

    await escrow.connect(owner).deposit(account.address, { value: 1000n });

    expect(await escrow.balances(account.address)).to.equal(1000n);
  });

  it('non-owner cannot deposit', async () => {
    const { escrow, account } = await deployFixture();

    await expect(escrow.connect(account).deposit(account.address, { value: 1000n }))
      .to.be.revertedWithCustomError(escrow, 'NotOwner');
  });

  it('owner can set a covenant for an account', async () => {
    const { escrow, owner, account } = await deployFixture();

    await expect(escrow.connect(owner).setCovenant(account.address, 500n))
      .to.emit(escrow, 'CovenantSet')
      .withArgs(account.address, 500n);

    expect(await escrow.minimumBalance(account.address)).to.equal(500n);
  });

  it('non-owner cannot set a covenant', async () => {
    const { escrow, account } = await deployFixture();

    await expect(escrow.connect(account).setCovenant(account.address, 500n))
      .to.be.revertedWithCustomError(escrow, 'NotOwner');
  });

  it('non-owner cannot release', async () => {
    const { escrow, owner, account } = await deployFixture();

    await escrow.connect(owner).deposit(account.address, { value: 1000n });

    await expect(escrow.connect(account).release(account.address, 100n))
      .to.be.revertedWithCustomError(escrow, 'NotOwner');
  });

  it('releases funds to the account when the resulting balance stays at or above the covenant', async () => {
    const { ethers, escrow, owner, account } = await deployFixture();

    await escrow.connect(owner).deposit(account.address, { value: 1000n });
    await escrow.connect(owner).setCovenant(account.address, 500n);

    // release sends native funds back to `account` — assert both the event and that the
    // account's wallet balance actually increased by the released amount. account is not the
    // tx sender (owner is), so no gas touches it: the delta is exactly the released amount.
    const balanceBefore = await ethers.provider.getBalance(account.address);
    const tx = escrow.connect(owner).release(account.address, 400n);
    await expect(tx).to.emit(escrow, 'Released').withArgs(account.address, 400n, 600n);
    const balanceAfter = await ethers.provider.getBalance(account.address);

    expect(balanceAfter - balanceBefore).to.equal(400n);
    expect(await escrow.balances(account.address)).to.equal(600n);
  });

  // P0 — this is the literal "code-enforced, not promised" claim being pitched to
  // Allaire. If this test doesn't pass, the headline of the entire Arc demo is false.
  it('P0: refuses to release funds that would drop the balance below the covenant', async () => {
    const { escrow, owner, account } = await deployFixture();

    await escrow.connect(owner).deposit(account.address, { value: 1000n });
    await escrow.connect(owner).setCovenant(account.address, 500n);

    // Releasing 600 would leave 400, below the 500 covenant — must revert.
    await expect(escrow.connect(owner).release(account.address, 600n))
      .to.be.revertedWithCustomError(escrow, 'CovenantViolation')
      .withArgs(600n, 400n, 500n);

    // Balance must be unchanged — the revert must not have partially applied.
    expect(await escrow.balances(account.address)).to.equal(1000n);
  });

  it('refuses to release more than the account has deposited', async () => {
    const { escrow, owner, account } = await deployFixture();

    await escrow.connect(owner).deposit(account.address, { value: 100n });

    await expect(escrow.connect(owner).release(account.address, 200n))
      .to.be.revertedWithCustomError(escrow, 'InsufficientBalance')
      .withArgs(200n, 100n);
  });

  it('allows releasing exactly down to the covenant floor', async () => {
    const { escrow, owner, account } = await deployFixture();

    await escrow.connect(owner).deposit(account.address, { value: 1000n });
    await escrow.connect(owner).setCovenant(account.address, 500n);

    // Releasing exactly 500 leaves exactly 500 — the boundary case, must succeed.
    // Awaiting the tx directly throws if it reverts, so a successful send proves non-revert;
    // the balance assertion then confirms the floor was reached exactly.
    await escrow.connect(owner).release(account.address, 500n);
    expect(await escrow.balances(account.address)).to.equal(500n);
  });
});
