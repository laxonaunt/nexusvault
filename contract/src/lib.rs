#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, panic_with_error,
    Address, Bytes, Env, Symbol, Vec, vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ContractError {
    NotAdmin           = 1,
    AgentNotFound      = 2,
    DailyLimitExceeded = 3,
    VendorNotApproved  = 4,
    CategoryNotAllowed = 5,
    AgentLocked        = 6,
    AlreadyRegistered  = 7,
}

#[contracttype]
#[derive(Clone)]
pub struct AgentPolicy {
    pub daily_limit: i128,
    pub categories: Vec<Symbol>,
    pub approved_vendors: Vec<Address>,
    pub is_locked: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct AgentState {
    pub policy: AgentPolicy,
    pub daily_spent: i128,
    pub day_start_epoch: u64,
    pub payment_count: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Agent(Symbol),
    AgentList,
}

const SECONDS_IN_DAY: u64 = 86400;

#[contract]
pub struct NexusVault;

#[contractimpl]
impl NexusVault {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, ContractError::AlreadyRegistered);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        let empty: Vec<Symbol> = vec![&env];
        env.storage().persistent().set(&DataKey::AgentList, &empty);
    }

    pub fn register_agent(
        env: Env,
        agent_id: Symbol,
        _wallet: Address,
        daily_limit: i128,
        categories: Vec<Symbol>,
        approved_vendors: Vec<Address>,
    ) {
        Self::require_admin(&env);
        if env.storage().persistent().has(&DataKey::Agent(agent_id.clone())) {
            panic_with_error!(&env, ContractError::AlreadyRegistered);
        }
        let policy = AgentPolicy { daily_limit, categories, approved_vendors, is_locked: false };
        let state = AgentState {
            policy,
            daily_spent: 0,
            day_start_epoch: env.ledger().timestamp(),
            payment_count: 0,
        };
        env.storage().persistent().set(&DataKey::Agent(agent_id.clone()), &state);
        let mut list: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&DataKey::AgentList)
            .unwrap_or(vec![&env]);
        list.push_back(agent_id);
        env.storage().persistent().set(&DataKey::AgentList, &list);
    }

    pub fn check_payment(
        env: Env,
        agent_id: Symbol,
        amount: i128,
        vendor: Address,
        category: Symbol,
    ) -> bool {
        let mut state: AgentState = match env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
        {
            Some(s) => s,
            None => return false,
        };

        if state.policy.is_locked {
            return false;
        }

        let now = env.ledger().timestamp();
        if now - state.day_start_epoch >= SECONDS_IN_DAY {
            state.daily_spent = 0;
            state.day_start_epoch = now;
        }

        if state.daily_spent + amount > state.policy.daily_limit {
            return false;
        }

        if !state.policy.approved_vendors.iter().any(|v| v == vendor) {
            return false;
        }

        if !state.policy.categories.iter().any(|c| c == category) {
            return false;
        }

        state.daily_spent += amount;
        state.payment_count += 1;
        env.storage().persistent().set(&DataKey::Agent(agent_id), &state);
        true
    }

    pub fn record_payment(
        env: Env,
        agent_id: Symbol,
        _amount: i128,
        _vendor: Address,
        _tx_hash: Bytes,
    ) {
        if !env.storage().persistent().has(&DataKey::Agent(agent_id)) {
            panic_with_error!(&env, ContractError::AgentNotFound);
        }
    }

    pub fn lock_agent(env: Env, agent_id: Symbol) {
        Self::require_admin(&env);
        let mut state: AgentState = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::AgentNotFound));
        state.policy.is_locked = true;
        env.storage().persistent().set(&DataKey::Agent(agent_id), &state);
    }

    pub fn unlock_agent(env: Env, agent_id: Symbol) {
        Self::require_admin(&env);
        let mut state: AgentState = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::AgentNotFound));
        state.policy.is_locked = false;
        env.storage().persistent().set(&DataKey::Agent(agent_id), &state);
    }

    pub fn update_limit(env: Env, agent_id: Symbol, new_limit: i128) {
        Self::require_admin(&env);
        let mut state: AgentState = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::AgentNotFound));
        state.policy.daily_limit = new_limit;
        env.storage().persistent().set(&DataKey::Agent(agent_id), &state);
    }

    pub fn add_vendor(env: Env, agent_id: Symbol, vendor: Address) {
        Self::require_admin(&env);
        let mut state: AgentState = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::AgentNotFound));
        state.policy.approved_vendors.push_back(vendor);
        env.storage().persistent().set(&DataKey::Agent(agent_id), &state);
    }

    pub fn remove_vendor(env: Env, agent_id: Symbol, vendor: Address) {
        Self::require_admin(&env);
        let mut state: AgentState = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::AgentNotFound));
        let vendors = state.policy.approved_vendors.clone();
        let mut new_vendors: Vec<Address> = vec![&env];
        for v in vendors.iter() {
            if v != vendor {
                new_vendors.push_back(v);
            }
        }
        state.policy.approved_vendors = new_vendors;
        env.storage().persistent().set(&DataKey::Agent(agent_id), &state);
    }

    pub fn get_agent_state(env: Env, agent_id: Symbol) -> AgentState {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent_id))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::AgentNotFound))
    }

    pub fn get_all_agents(env: Env) -> Vec<Symbol> {
        env.storage()
            .persistent()
            .get(&DataKey::AgentList)
            .unwrap_or(vec![&env])
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, ContractError::NotAdmin));
        admin.require_auth();
    }
}