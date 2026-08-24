package com.acme.gateway.repository;

import com.acme.gateway.domain.CheckoutRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface CheckoutRepository extends JpaRepository<CheckoutRecord, Long> {
    List<CheckoutRecord> findByStatus(String status);
    @Modifying @Query(value = "update sales.checkout_record set status = ?2 where id = ?1", nativeQuery = true)
    int updateStatus(long id, String status);
}
