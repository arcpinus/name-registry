import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-web3';
import '@typechain/hardhat';
import 'solidity-coverage';

export default {
  networks: {
    hardhat: {},
  },
  typechain: {
    outDir: 'src/types',
    target: 'ethers-v5',
  },
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};
