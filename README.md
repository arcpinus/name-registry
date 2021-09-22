# NameRegistry

## Register name

To register name, user need to register signature first, and wait some blocks to prevent frontrunning.
User need to pay lock amount and register fee when register.
registerFee = feePerChar \* name.length
Locked ether will be kept in nameRegistry contract, and register fee will be forewarded to treasury address.

If there is same name registered by other and it is expired, then it will be replaced by new owner.

## Renew name

User can renew any time after they register
If user renew before maturity, then new maturity will be old maturity + lock period
If user renew after maturity, then new maturity will be block.timestamp + lock period
If name has been replaced by other after maturity, he cannot renew anymore.

Renew fee is same as register fee

## Unlock

User can unlock ether after name expired

## WithdrawUnlockedEther

When name replaced by other, his ether will be unlock and can withdraw any time.
