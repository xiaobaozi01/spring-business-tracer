package com.acme.account.repository;

import com.acme.account.domain.CustomerAccount;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AccountRepository extends JpaRepository<CustomerAccount, Long> {
}
