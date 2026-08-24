package com.acme.inventory.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface InventoryMapper {
    int findAvailable(@Param("sku") String sku);
    void decreaseStock(@Param("sku") String sku, @Param("quantity") int quantity);
    void insertReservation(@Param("sku") String sku, @Param("quantity") int quantity);
    List<String> findExpiredReservations();
    void restoreStock(@Param("sku") String sku);
    void deleteReservation(@Param("sku") String sku);
}
