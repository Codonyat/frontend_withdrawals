// Contracts
const CONTRACTS = {
  vault: "0xB91AE2c8365FD45030abA84a4666C4dB074E53E7",
  sir: "0x1278B112943Abc025a0DF081Ee42369414c3A834 ",
  apeImplementation: "0x8E3a5ec5a8B23Fd169F38C9788B19e72aEd97b5A",
};

let provider;

// Initialize when loaded
window.addEventListener("load", () => {
  document.getElementById("connect").addEventListener("click", connectWallet);
});

async function connectWallet() {
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    scanPositions(await signer.getAddress());
  } catch (error) {
    showError(`Connection failed: ${error.message}`);
  }
}

async function scanPositions(address) {
  try {
    showLoading(true);

    const results = {
      tea: [],
      ape: [],
      sir: {
        staked: 0n,
        dividends: 0n,
        lper: 0n,
        contributor: 0n,
      },
    };

    // Get contracts
    const vault = new ethers.Contract(
      CONTRACTS.vault,
      [
        "function paramsById(uint48) view returns (tuple(address,address,int8))",
        "function numberOfVaults() view returns (uint48)",
        "function balanceOf(address,uint256) view returns (uint256)",
        "function unclaimedRewards(uint256,address) view returns (uint80)",
      ],
      provider
    );

    const sir = new ethers.Contract(
      CONTRACTS.sir,
      [
        "function contributorUnclaimedSIR(address) view returns (uint80)",
        "function stakeOf(address) view returns (tuple(uint80,uint80))",
        "function unclaimedDividends(address) view returns (uint96)",
      ],
      provider
    );

    // Scan vaults
    const numVaults = await vault.numberOfVaults();

    for (let vaultId = 1n; vaultId <= numVaults; vaultId++) {
      const params = await vault.paramsById(vaultId);

      // TEA Balance (ERC1155)
      const teaBalance = await vault.balanceOf(address, vaultId);
      if (teaBalance > 0n) {
        results.tea.push({
          vaultId: Number(vaultId),
          collateral: params[1],
          balance: teaBalance.toString(),
        });
      }
      console.log("TEA Balance for Vault", vaultId, "is", teaBalance);

      // APE Balance (ERC20)
      const apeAddress = calculateApeAddress(vaultId);
      console.log("APE address for Vault", vaultId, "is", apeAddress);
      const apeBalance = await getERC20Balance(apeAddress, address);
      if (apeBalance > 0n) {
        results.ape.push({
          vaultId: Number(vaultId),
          collateral: params[1],
          balance: apeBalance.toString(),
        });
      }
      console.log("APE Balance for Vault", vaultId, "is", apeBalance);

      // SIR LP rewards
      const lperRewards = await vault.unclaimedRewards(vaultId, address);
      results.sir.lper += lperRewards;
      console.log("LP rewards for Vault", vaultId, "is", lperRewards);
    }

    // SIR positions
    results.sir.contributor = await sir.contributorUnclaimedSIR(address);
    const [unlocked, locked] = await sir.stakeOf(address);
    results.sir.staked = locked;
    results.sir.dividends = await sir.unclaimedDividends(address);

    displayResults(results);
  } catch (error) {
    showError(`Scan failed: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

// Deterministic APE address calculation
function calculateApeAddress(vaultId) {
  // Using ClonesWithImmutableArgs pattern
  const create2ProxyBytecodeHash =
    "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";

  // Convert vaultId to 32-byte hex string
  const salt = ethers.toBeHex(vaultId, 32);

  // Calculate proxy address (CREATE2)
  const proxyAddress = ethers.getCreate2Address(
    CONTRACTS.vault, // Deployer address
    salt, // vaultId as salt
    create2ProxyBytecodeHash
  );

  // Calculate final CREATE3 address (RLP encoding)
  const rlpEncoded = ethers.concat([
    "0xd6", // RLP header (0xc0 + 0x16)
    "0x94", // Proxy address prefix (0x80 + 0x14)
    proxyAddress,
    "0x01", // Nonce
  ]);

  return ethers.dataSlice(ethers.keccak256(rlpEncoded), 12, 32);
}

async function getERC20Balance(tokenAddress, userAddress) {
  const contract = new ethers.Contract(
    tokenAddress,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  return await contract.balanceOf(userAddress);
}

function displayResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = `
        <h3>Your Positions</h3>
        ${renderSection("TEA Positions", results.tea)}
        ${renderSection("APE Positions", results.ape)}
        ${renderSirResults(results.sir)}
    `;
}

function renderSection(title, items) {
  if (!items.length) return "";
  return `
        <h4>${title}</h4>
        <ul>
            ${items
              .map(
                (item) => `
                <li>Vault ${item.vaultId}: ${ethers.formatUnits(
                  item.balance
                )} (${item.collateral})</li>
            `
              )
              .join("")}
        </ul>
    `;
}

function renderSirResults(sir) {
  return `
        <h4>SIR Positions</h4>
        <ul>
            <li>Staked: ${ethers.formatUnits(sir.staked)}</li>
            <li>Dividends: ${ethers.formatUnits(sir.dividends)} ETH</li>
            <li>LP Rewards: ${ethers.formatUnits(sir.lper)}</li>
            <li>Contributor Rewards: ${ethers.formatUnits(sir.contributor)}</li>
        </ul>
    `;
}

function showLoading(show) {
  document.getElementById("loading").style.display = show ? "block" : "none";
}

function showError(message) {
  const container = document.getElementById("results");
  container.innerHTML = `<div style="color: red">${message}</div>`;
}
