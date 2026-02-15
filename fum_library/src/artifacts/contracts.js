// artifacts/contracts.js
      /**
       * Contract ABIs and addresses for the F.U.M. project
       * This file is auto-generated and should not be edited directly
       */

      // Contract ABIs and addresses
      const contracts = {
  "bob": {
    "abi": [
      {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          }
        ],
        "name": "OwnableInvalidOwner",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "account",
            "type": "address"
          }
        ],
        "name": "OwnableUnauthorizedAccount",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "bitmap",
            "type": "uint256"
          }
        ],
        "name": "CustomizationUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "previousOwner",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "paramName",
            "type": "string"
          }
        ],
        "name": "ParameterUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint8",
            "name": "template",
            "type": "uint8"
          }
        ],
        "name": "TemplateSelected",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "bool",
            "name": "authorized",
            "type": "bool"
          }
        ],
        "name": "VaultAuthorized",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "TEMPLATE_AGGRESSIVE",
        "outputs": [
          {
            "internalType": "uint8",
            "name": "",
            "type": "uint8"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "TEMPLATE_CONSERVATIVE",
        "outputs": [
          {
            "internalType": "uint8",
            "name": "",
            "type": "uint8"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "TEMPLATE_MODERATE",
        "outputs": [
          {
            "internalType": "uint8",
            "name": "",
            "type": "uint8"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "TEMPLATE_NONE",
        "outputs": [
          {
            "internalType": "uint8",
            "name": "",
            "type": "uint8"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "TEMPLATE_STABLECOIN",
        "outputs": [
          {
            "internalType": "uint8",
            "name": "",
            "type": "uint8"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "VERSION",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "authorizeVault",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "authorizedVaults",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "customizationBitmap",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "deauthorizeVault",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "emergencyExitTrigger",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "feeReinvestment",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getAllParameters",
        "outputs": [
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getEmergencyExitTrigger",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getFeeReinvestment",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getMaxSlippage",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getReinvestmentRatio",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getReinvestmentTrigger",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getTargetRangeLower",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getTargetRangeUpper",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getVersion",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "maxSlippage",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "reinvestmentRatio",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "reinvestmentTrigger",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "resetAll",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "resetToTemplate",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint8",
            "name": "template",
            "type": "uint8"
          }
        ],
        "name": "selectTemplate",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "selectedTemplate",
        "outputs": [
          {
            "internalType": "uint8",
            "name": "",
            "type": "uint8"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bool",
            "name": "reinvest",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "trigger",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "ratio",
            "type": "uint16"
          }
        ],
        "name": "setFeeParameters",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint16",
            "name": "upperRange",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "lowerRange",
            "type": "uint16"
          }
        ],
        "name": "setRangeParameters",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint16",
            "name": "slippage",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "exitTrigger",
            "type": "uint16"
          }
        ],
        "name": "setRiskParameters",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "targetRangeLower",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "targetRangeUpper",
        "outputs": [
          {
            "internalType": "uint16",
            "name": "",
            "type": "uint16"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    "addresses": {
      "1337": "0xb782f215aB9C9B40287998Ce9cC0a127Ecd7B78C",
      "1338": "0x636279C6135f2F50eFDFF6650A38Defb3437AC42",
      "42161": "0xeAdA21fc37F548d4813b74C9f0a2eA66ff9fef27"
    }
  },
  "PositionVault": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_owner",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_permit2",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_factory",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "ECDSAInvalidSignature",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "length",
            "type": "uint256"
          }
        ],
        "name": "ECDSAInvalidSignatureLength",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "s",
            "type": "bytes32"
          }
        ],
        "name": "ECDSAInvalidSignatureS",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ReentrancyGuardReentrantCall",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          }
        ],
        "name": "SafeERC20FailedOperation",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "executor",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "bool",
            "name": "isAuthorized",
            "type": "bool"
          }
        ],
        "name": "ExecutorChanged",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "uint256",
            "name": "tokenId",
            "type": "uint256"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "nftContract",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "to",
            "type": "address"
          }
        ],
        "name": "PositionWithdrawn",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "strategy",
            "type": "address"
          }
        ],
        "name": "StrategyChanged",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "string[]",
            "name": "platforms",
            "type": "string[]"
          }
        ],
        "name": "TargetPlatformsUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "string[]",
            "name": "tokens",
            "type": "string[]"
          }
        ],
        "name": "TargetTokensUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "TokensWithdrawn",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "target",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "indexed": false,
            "internalType": "bool",
            "name": "success",
            "type": "bool"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "txType",
            "type": "string"
          }
        ],
        "name": "TransactionExecuted",
        "type": "event"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          }
        ],
        "name": "approve",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          }
        ],
        "name": "burn",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          }
        ],
        "name": "collect",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          }
        ],
        "name": "decreaseLiquidity",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          }
        ],
        "name": "execute",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "executor",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "factory",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getTargetPlatforms",
        "outputs": [
          {
            "internalType": "string[]",
            "name": "",
            "type": "string[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getTargetTokens",
        "outputs": [
          {
            "internalType": "string[]",
            "name": "",
            "type": "string[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getVersion",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          },
          {
            "internalType": "uint256[]",
            "name": "values",
            "type": "uint256[]"
          }
        ],
        "name": "increaseLiquidity",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "hash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          }
        ],
        "name": "isValidSignature",
        "outputs": [
          {
            "internalType": "bytes4",
            "name": "magicValue",
            "type": "bytes4"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          },
          {
            "internalType": "uint256[]",
            "name": "values",
            "type": "uint256[]"
          }
        ],
        "name": "mint",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "name": "onERC721Received",
        "outputs": [
          {
            "internalType": "bytes4",
            "name": "",
            "type": "bytes4"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "permit2",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "removeExecutor",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "removeStrategy",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_executor",
            "type": "address"
          }
        ],
        "name": "setExecutor",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_strategy",
            "type": "address"
          }
        ],
        "name": "setStrategy",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "string[]",
            "name": "platforms",
            "type": "string[]"
          }
        ],
        "name": "setTargetPlatforms",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "string[]",
            "name": "tokens",
            "type": "string[]"
          }
        ],
        "name": "setTargetTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "strategy",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "targets",
            "type": "address[]"
          },
          {
            "internalType": "bytes[]",
            "name": "data",
            "type": "bytes[]"
          },
          {
            "internalType": "uint256[]",
            "name": "values",
            "type": "uint256[]"
          }
        ],
        "name": "swap",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "results",
            "type": "bool[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "weth",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "unwrapAndWithdrawETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "weth",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "unwrapETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "withdrawETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "nftContract",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "tokenId",
            "type": "uint256"
          }
        ],
        "name": "withdrawPosition",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "withdrawTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "weth",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "wrapETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "stateMutability": "payable",
        "type": "receive"
      }
    ],
    "addresses": {}
  },
  "VaultFactory": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "initialOwner",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_permit2",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          }
        ],
        "name": "OwnableInvalidOwner",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "account",
            "type": "address"
          }
        ],
        "name": "OwnableUnauthorizedAccount",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "validator",
            "type": "address"
          }
        ],
        "name": "LiquidityValidatorUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "previousOwner",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "router",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "validator",
            "type": "address"
          }
        ],
        "name": "SwapValidatorUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "user",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "userVaultCount",
            "type": "uint256"
          }
        ],
        "name": "VaultCreated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "name",
            "type": "string"
          }
        ],
        "name": "VaultNameUpdated",
        "type": "event"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "allVaults",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          }
        ],
        "name": "createVault",
        "outputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getTotalVaultCount",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          }
        ],
        "name": "getVaultCount",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getVaultInfo",
        "outputs": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "creationTime",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "creationBlock",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          }
        ],
        "name": "getVaults",
        "outputs": [
          {
            "internalType": "address[]",
            "name": "",
            "type": "address[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getVersion",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "isVault",
        "outputs": [
          {
            "internalType": "bool",
            "name": "_isVault",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "liquidityValidators",
        "outputs": [
          {
            "internalType": "contract ILiquidityValidator",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "permit2",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "contract ILiquidityValidator",
            "name": "validator",
            "type": "address"
          }
        ],
        "name": "setLiquidityValidator",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "router",
            "type": "address"
          },
          {
            "internalType": "contract ISwapValidator",
            "name": "validator",
            "type": "address"
          }
        ],
        "name": "setSwapValidator",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "swapValidators",
        "outputs": [
          {
            "internalType": "contract ISwapValidator",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          }
        ],
        "name": "updateVaultName",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "userVaults",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateBurn",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateCollect",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateDecreaseLiquidity",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateIncreaseLiquidity",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateMint",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "router",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateSwap",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "vaultInfo",
        "outputs": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "creationTime",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "creationBlock",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ],
    "addresses": {
      "1337": "0xa9672a817618Ae03A8A342d004e3b53f50798948",
      "1338": "0xa9672a817618Ae03A8A342d004e3b53f50798948",
      "42161": "0x31709a06fB0B7DAe79B35f94cDc9D74FB348103B"
    }
  },
  "TJPositionManager": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_lbRouter",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "ReentrancyGuardReentrantCall",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          }
        ],
        "name": "SafeERC20FailedOperation",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "lbPair",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          }
        ],
        "name": "FeesCollected",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "lbPair",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256[]",
            "name": "depositIds",
            "type": "uint256[]"
          },
          {
            "indexed": false,
            "internalType": "uint256[]",
            "name": "liquidityMinted",
            "type": "uint256[]"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountXAdded",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountYAdded",
            "type": "uint256"
          }
        ],
        "name": "PositionCreated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "lbPair",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountXAdded",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountYAdded",
            "type": "uint256"
          }
        ],
        "name": "PositionIncreased",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "lbPair",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "percentage",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          }
        ],
        "name": "PositionRemoved",
        "type": "event"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountXMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountYMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "activeIdDesired",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "idSlippage",
            "type": "uint256"
          },
          {
            "internalType": "int256[]",
            "name": "deltaIds",
            "type": "int256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "distributionX",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "distributionY",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "addToPosition",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountXAdded",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountYAdded",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          }
        ],
        "name": "collectFees",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "lbPair",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountXMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountYMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "activeIdDesired",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "idSlippage",
            "type": "uint256"
          },
          {
            "internalType": "int256[]",
            "name": "deltaIds",
            "type": "int256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "distributionX",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "distributionY",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "createPosition",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "percentage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountXMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountYMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "decreaseLiquidity",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          }
        ],
        "name": "getAccruedFees",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "feesX",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "feesY",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          }
        ],
        "name": "getPosition",
        "outputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "vault",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "lbPair",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "tokenX",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "tokenY",
                "type": "address"
              },
              {
                "internalType": "uint16",
                "name": "binStep",
                "type": "uint16"
              },
              {
                "internalType": "uint256[]",
                "name": "depositIds",
                "type": "uint256[]"
              },
              {
                "internalType": "uint256[]",
                "name": "liquidityMinted",
                "type": "uint256[]"
              },
              {
                "internalType": "uint256[]",
                "name": "originalShareX",
                "type": "uint256[]"
              },
              {
                "internalType": "uint256[]",
                "name": "originalShareY",
                "type": "uint256[]"
              },
              {
                "internalType": "uint256",
                "name": "createdAt",
                "type": "uint256"
              },
              {
                "internalType": "bool",
                "name": "active",
                "type": "bool"
              }
            ],
            "internalType": "struct TJPositionManager.Position",
            "name": "",
            "type": "tuple"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getPositionCount",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "getPositionsByVault",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "lbRouter",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256[]",
            "name": "",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "",
            "type": "uint256[]"
          },
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "name": "onERC1155BatchReceived",
        "outputs": [
          {
            "internalType": "bytes4",
            "name": "",
            "type": "bytes4"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "name": "onERC1155Received",
        "outputs": [
          {
            "internalType": "bytes4",
            "name": "",
            "type": "bytes4"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountXMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountYMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "removePosition",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountX",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountY",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes4",
            "name": "interfaceId",
            "type": "bytes4"
          }
        ],
        "name": "supportsInterface",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ],
    "addresses": {
      "1337": "0x13B15CCD923853eB9322C3aBBb91b7A93E3a8B6e",
      "1338": "0xe80a4962191410D6D07be8655c36F57D05d7034e"
    }
  },
  "UniversalRouterValidator": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateSwap",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      }
    ],
    "addresses": {}
  },
  "UniswapV3PositionValidator": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateBurn",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateCollect",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateDecreaseLiquidity",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateIncreaseLiquidity",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateMint",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      }
    ],
    "addresses": {}
  },
  "UniswapV4PositionValidator": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateBurn",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateCollect",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateDecreaseLiquidity",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateIncreaseLiquidity",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateMint",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      }
    ],
    "addresses": {}
  },
  "TJPositionValidator": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "validateBurn",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateCollect",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateDecreaseLiquidity",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateIncreaseLiquidity",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateMint",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      }
    ],
    "addresses": {
      "1337": "0x27998b19Ea0fcedDBa50915dE46692Ccef961e17",
      "1338": "0xCBd482597a26c0255a5F38B3360bE2015D628187"
    }
  },
  "TJSwapValidator": {
    "abi": [
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "vault",
            "type": "address"
          }
        ],
        "name": "validateSwap",
        "outputs": [],
        "stateMutability": "pure",
        "type": "function"
      }
    ],
    "addresses": {
      "1338": "0x88EE5050eBA44e68A0146e830d6E08aBda453f21"
    }
  }
};

      export default contracts;