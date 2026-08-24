package com.acme.account.service;

import com.acme.account.domain.CustomerAccount;
import com.acme.account.repository.AccountRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {
    private final AccountRepository accountRepository;

    public AccountService(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @Transactional
    public void activate(Long id) {
        CustomerAccount account = accountRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("账户不存在"));
        account.activate();
        accountRepository.save(account);
    }
}
