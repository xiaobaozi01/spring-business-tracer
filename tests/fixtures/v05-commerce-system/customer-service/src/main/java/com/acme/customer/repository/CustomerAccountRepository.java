package com.acme.customer.repository;

import com.acme.customer.domain.CustomerAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface CustomerAccountRepository extends JpaRepository<CustomerAccount, Long> {
    @Override
    Optional<CustomerAccount> findById(Long id);
}
