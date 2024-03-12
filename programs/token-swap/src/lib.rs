use anchor_lang::{
    prelude::*,
    solana_program::{entrypoint::ProgramResult, instruction::Instruction, program::invoke, program::invoke_signed}
};
use anchor_spl::token::Token;

declare_id!("CzJLugPC4q4tsFyQuVoVwcfHE1VJgKdtGZrhXWFsKmc2");

pub const VAULT_SEED: &[u8] = b"vault-authority";

mod jupiter {
    use anchor_lang::declare_id;
    declare_id!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
}

#[derive(Clone)]
pub struct Jupiter;

impl anchor_lang::Id for Jupiter {
    fn id() -> Pubkey {
        jupiter::id()
    }
}

#[error_code]
pub enum ErrorCode {
    InvalidReturnData,
    InvalidJupiterProgram,
    IncorrectOwner,
}

#[program]
pub mod token_swap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {

        sol_transfer_user(
            ctx.accounts.admin.to_account_info().clone(),
            ctx.accounts.vault.to_account_info().clone(),
            ctx.accounts.system_program.to_account_info().clone(),
            ctx.accounts.rent.minimum_balance(0),
        )?;

        Ok(())
    }

    pub fn token_swap(ctx: Context<TokenSwap>, data: Vec<u8>, tmp: Vec<u8>) -> Result<()> {
        msg!("just a text: {:?}", String::from_utf8(tmp).unwrap());

        let vault_bump = ctx.bumps.get("vault").unwrap().to_le_bytes();

        msg!("Swap on Jupiter");
        swap_on_jupiter(
            ctx.remaining_accounts,
            ctx.accounts.jupiter_program.clone(),
            data,
            ctx.accounts.vault.clone(),
            &vault_bump
        )?;

        Ok(())
    }
}

fn swap_on_jupiter<'info>(
    remaining_accounts: &[AccountInfo],
    jupiter_program: Program<'info, Jupiter>,
    data: Vec<u8>,
    vault: AccountInfo,
    vault_bump: &[u8],
) -> ProgramResult {

    let mut accounts: Vec<AccountMeta> = remaining_accounts
        .iter()
        .map(|acc| AccountMeta {
            pubkey: *acc.key,
            is_signer: acc.is_signer,
            is_writable: acc.is_writable,
        })
        .collect();
    
    for account in accounts.iter_mut() {
        if account.pubkey.to_string() == vault.key().to_string() {
            account.is_signer = true;
            break; // Assuming there's only one matching pubkey, exit loop after updating
        }
    }


    let accounts_infos: Vec<AccountInfo> = remaining_accounts
        .iter()
        .map(|acc| AccountInfo { ..acc.clone() })
        .collect();

    // TODO: Check the first 8 bytes. Only Jupiter Route CPI allowed.

    let signer_seeds: &[&[&[u8]]] = &[
        &[VAULT_SEED, vault_bump.as_ref()]
    ];
    
    invoke_signed(
        &Instruction {
            program_id: *jupiter_program.key,
            accounts,
            data,
        },
        &accounts_infos,
        signer_seeds,
    )
}


#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_ref()],
        bump,
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TokenSwap<'info> {
    #[account(
        mut, 
        seeds = [VAULT_SEED], 
        bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault: AccountInfo<'info>,

    pub jupiter_program: Program<'info, Jupiter>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}


pub fn sol_transfer_user<'a>(
    source: AccountInfo<'a>,
    destination: AccountInfo<'a>,
    system_program: AccountInfo<'a>,
    amount: u64,
) -> Result<()> {
    let ix = solana_program::system_instruction::transfer(source.key, destination.key, amount);
    invoke(&ix, &[source, destination, system_program])?;
    Ok(())
}