#![cfg_attr(not(any(test, feature = "testutils")), no_std)]
#![cfg_attr(not(any(test, feature = "testutils")), no_main)]

mod contract;
mod events;
mod storage;
mod types;

pub use contract::Corpuslane;
pub use types::{Dataset, License, LicenseStatus, LicenseTerms};
