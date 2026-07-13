import { expect } from 'chai';
import { network } from 'hardhat';

/**
 * AgentMandate — contract testing bar, plan §17.7.
 *
 * The owner-admin surface is implemented and tested for real. The money-movement + idempotency
 * cases (the risk surface, TODO(Vadim) in AgentMandate.sol) are `it.skip` so the Definition of
 * Done is visible in the suite: un-skip each as the corresponding logic lands.
 */
describe('AgentMandate', () => {
  const FLOOR = 20_000n;
  const MAX_TICKET = 10_000n;
  const DAILY_CAP = 25_000n;

  async function deployFixture() {
    const { ethers } = await network.connect();
    const [owner, agent, stranger] = await ethers.getSigners();
    const AgentMandate = await ethers.getContractFactory('AgentMandate');
    const mandate = await AgentMandate.deploy(agent.address, FLOOR, MAX_TICKET, DAILY_CAP);
    return { ethers, mandate, owner, agent, stranger };
  }

  // ── Implemented: roles & mandate config ──────────────────────────────────
  it('sets roles and mandate bounds at construction', async () => {
    const { mandate, owner, agent } = await deployFixture();
    expect(await mandate.owner()).to.equal(owner.address);
    expect(await mandate.agent()).to.equal(agent.address);
    expect(await mandate.floorUsdc()).to.equal(FLOOR);
    expect(await mandate.maxTicketUsdc()).to.equal(MAX_TICKET);
    expect(await mandate.dailyCapUsdc()).to.equal(DAILY_CAP);
    expect(await mandate.revoked()).to.equal(false);
  });

  it('owner can retune the mandate; non-owner cannot', async () => {
    const { mandate, owner, stranger } = await deployFixture();
    await expect(mandate.connect(owner).setMandate(30_000n, 5_000n, 12_000n))
      .to.emit(mandate, 'MandateChanged')
      .withArgs(30_000n, 5_000n, 12_000n);
    expect(await mandate.floorUsdc()).to.equal(30_000n);
    await expect(mandate.connect(stranger).setMandate(1n, 1n, 1n))
      .to.be.revertedWithCustomError(mandate, 'NotOwner');
  });

  it('owner can revoke and reinstate; non-owner cannot', async () => {
    const { mandate, owner, stranger } = await deployFixture();
    await expect(mandate.connect(owner).revoke()).to.emit(mandate, 'Revoked').withArgs(owner.address);
    expect(await mandate.revoked()).to.equal(true);
    await expect(mandate.connect(owner).reinstate()).to.emit(mandate, 'Reinstated').withArgs(owner.address);
    expect(await mandate.revoked()).to.equal(false);
    await expect(mandate.connect(stranger).revoke()).to.be.revertedWithCustomError(mandate, 'NotOwner');
  });

  it('owner funds the company balance', async () => {
    const { mandate, owner } = await deployFixture();
    await expect(mandate.connect(owner).fundCompany({ value: 50_000n }))
      .to.emit(mandate, 'CompanyFunded');
    expect(await mandate.companyBalance()).to.equal(50_000n);
  });

  // ── TODO(Vadim): the risk surface — un-skip as implemented (§17.7) ────────
  it.skip('deposit REVERTS when it would breach the floor (P0)');
  it.skip('deposit REVERTS above the per-ticket cap');
  it.skip('deposit REVERTS above the rolling-24h daily cap');
  it.skip('deposit is blocked when the mandate is revoked');
  it.skip('withdrawToCompany is ALLOWED even when revoked (fail-safe asymmetry)');
  it.skip('withdrawToCompany never applies floor/ticket/daily gates');
  it.skip('a reused decisionId REVERTS (idempotency)');
  it.skip('deposit/withdraw emit DecisionExecuted with the forecastHash receipt');
  it.skip('owner emergencyWithdrawAll sweeps both pools unconditionally');
});
